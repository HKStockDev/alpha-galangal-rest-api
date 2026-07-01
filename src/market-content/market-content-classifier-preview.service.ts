import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FormulasService } from '../formulas/formulas.service';
import { OrganizationEquitiesService } from '../organizations/organization-equities.service';
import type { ListOrgEquitiesQueryDto } from '../organizations/dto';
import { validateMarketContentClassifierOutput } from './market-content-classifier.contract';
import { EventFormulaRollupService, type EventRollupWindows } from './event-formula-rollup.service';
import { MarketContentPersistenceService } from './market-content-persistence.service';

export type PreviewLogLevel = 'info' | 'warn' | 'error';

export interface PreviewLogEntry {
  ts: string;
  level: PreviewLogLevel;
  message: string;
  detail?: Record<string, unknown>;
}

export interface MarketContentClassifierPreviewBody {
  organization_id: string;
  /** If empty, all tickers from the first page of org equities (up to equity_page_limit) are used for FMP. */
  ticker_symbols?: string[];
  /** Max equities rows loaded when resolving tickers (default 80). */
  equity_page_limit?: number;
  /** Optional filters when loading org equities (same semantics as org screener). */
  equity_query?: string;
  sector_cycles?: number[];
  industry_cycles?: number[];
  sub_industry_cycles?: number[];
  cycle_horizon?: '1m' | '3m' | '6m' | '12m' | '24m';
  /** FMP `from` (YYYY-MM-DD). */
  from?: string;
  /** FMP `to` (YYYY-MM-DD). */
  to?: string;
  /** Cap raw news rows returned from FMP before trimming (default 40). */
  max_news?: number;
  /** How many articles to send through Gemini after sorting by publish date (default 1). */
  classify_count?: number;
  /**
   * When true (default), validated classifier JSON is written to `market_content` +
   * `market_content_entities` (dedupe by `source` + `url` when URL is present).
   */
  persist?: boolean;
  /** CON-51 admin side: recompute windows to write after preview persistence. */
  con51_aggregate_windows?: EventRollupWindows;
}

/** Subset of Gemini `GenerateContentResponse.usageMetadata` we forward to clients. */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

export interface ClassifiedArticleResult {
  symbol: string | null;
  title: string | null;
  published_at: string | null;
  fmp_url: string | null;
  llm_json: Record<string, unknown> | null;
  llm_raw_text?: string;
  error?: string;
  /** Present when Gemini returned successfully (even if JSON parse failed). */
  gemini_usage?: GeminiUsageMetadata | null;
  /** How many HTTP attempts were made for this article (includes retries after 429). */
  gemini_attempts?: number;
  /** Set when `persist` saved this article to Postgres. */
  persisted_market_content_id?: string | null;
  /** Human-readable reason when persist was skipped or failed. */
  persist_error?: string | null;
  /** True when an existing `market_content` row (same source + url) was replaced. */
  persist_replaced_existing?: boolean;
}

export interface MarketContentClassifierPreviewResult {
  steps: PreviewLogEntry[];
  tickers_used: string[];
  fmp_articles_considered: number;
  results: ClassifiedArticleResult[];
}

interface FmpNewsRow {
  symbol?: string;
  publishedDate?: string;
  title?: string;
  text?: string;
  description?: string;
  url?: string;
  site?: string;
}

@Injectable()
export class MarketContentClassifierPreviewService {
  private readonly logger = new Logger(MarketContentClassifierPreviewService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly formulasService: FormulasService,
    private readonly organizationEquitiesService: OrganizationEquitiesService,
    private readonly marketContentPersistence: MarketContentPersistenceService,
    private readonly eventFormulaRollupService: EventFormulaRollupService,
  ) {}

  private push(
    steps: PreviewLogEntry[],
    level: PreviewLogLevel,
    message: string,
    detail?: Record<string, unknown>,
  ) {
    steps.push({ ts: new Date().toISOString(), level, message, detail });
  }

  private getFmpApiKey(): string | undefined {
    return this.config.get<string>('fmp.apiKey') ?? process.env.FMP_API_KEY;
  }

  private getFmpBaseUrl(): string {
    const raw =
      this.config.get<string>('fmp.baseUrl') ??
      process.env.FMP_API_BASE_URL ??
      'https://financialmodelingprep.com';
    return raw.replace(/\/$/, '');
  }

  private getGeminiApiKey(): string | undefined {
    return (
      this.config.get<string>('gemini.apiKey') ??
      this.config.get<string>('GEMINI_API_KEY') ??
      process.env.GEMINI_API_KEY
    );
  }

  private normalizeTickers(raw: string[] | undefined, cap: number): string[] {
    const set = new Set<string>();
    for (const t of raw ?? []) {
      const u = String(t).trim().toUpperCase();
      if (/^[A-Z0-9.\-]{1,20}$/.test(u)) set.add(u);
    }
    return [...set].slice(0, cap);
  }

  private async fetchFmpStockNews(
    symbols: string[],
    from?: string,
    to?: string,
    maxRows?: number,
  ): Promise<FmpNewsRow[]> {
    const apiKey = this.getFmpApiKey();
    if (!apiKey) {
      throw new BadRequestException('FMP_API_KEY is not configured on the server.');
    }
    const base = this.getFmpBaseUrl();
    const out: FmpNewsRow[] = [];
    const chunkSize = 8;
    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      const sp = new URLSearchParams();
      sp.set('symbols', chunk.join(','));
      sp.set('apikey', apiKey);
      if (from?.trim()) sp.set('from', from.trim());
      if (to?.trim()) sp.set('to', to.trim());
      sp.set('page', '0');
      sp.set('limit', String(Math.min(250, Math.max(10, maxRows ?? 80))));
      const url = `${base}/stable/news/stock?${sp.toString()}`;
      const res = await fetch(url);
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        const msg =
          typeof data === 'object' && data && 'Error Message' in data
            ? String((data as { 'Error Message'?: string })['Error Message'])
            : res.statusText;
        throw new BadRequestException(`FMP stock news failed: ${msg}`);
      }
      if (!Array.isArray(data)) {
        throw new BadRequestException('FMP stock news: expected JSON array');
      }
      for (const row of data) {
        if (row && typeof row === 'object') out.push(row as FmpNewsRow);
      }
    }
    const cap = Math.max(1, Math.min(maxRows ?? 80, 500));
    return out.slice(0, cap);
  }

  private buildUserPrompt(
    template: string,
    vars: Record<string, string>,
  ): string {
    let s = template;
    for (const [k, v] of Object.entries(vars)) {
      const re = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g');
      s = s.replace(re, v);
    }
    return s;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private getGeminiPreviewMaxAttempts(): number {
    const raw =
      this.config.get<string>('gemini.previewMaxAttempts') ??
      process.env.GEMINI_PREVIEW_MAX_ATTEMPTS;
    const n = raw != null && raw !== '' ? Number.parseInt(String(raw), 10) : 4;
    return Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 4;
  }

  private getGeminiPreviewRetryBaseMs(): number {
    const raw =
      this.config.get<string>('gemini.previewRetryBaseMs') ??
      process.env.GEMINI_PREVIEW_RETRY_BASE_MS;
    const n = raw != null && raw !== '' ? Number.parseInt(String(raw), 10) : 1500;
    return Number.isFinite(n) ? Math.min(120_000, Math.max(200, n)) : 1500;
  }

  private isGeminiRateLimitResponse(status: number, data: Record<string, unknown>): boolean {
    if (status === 429 || status === 503) return true;
    const err = data?.error as { code?: number; message?: string; status?: string } | undefined;
    if (err?.code === 429) return true;
    const st = String(err?.status ?? '').toUpperCase();
    if (st === 'RESOURCE_EXHAUSTED' || st === 'UNAVAILABLE') return true;
    const msg = String(err?.message ?? '').toLowerCase();
    if (msg.includes('resource exhausted') || msg.includes('too many requests')) return true;
    return false;
  }

  private pickUsageMetadata(raw: unknown): GeminiUsageMetadata | null {
    if (!raw || typeof raw !== 'object') return null;
    const u = raw as Record<string, unknown>;
    const out: GeminiUsageMetadata = {};
    for (const k of [
      'promptTokenCount',
      'candidatesTokenCount',
      'totalTokenCount',
      'thoughtsTokenCount',
      'cachedContentTokenCount',
    ] as const) {
      const v = u[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  private async callGeminiJson(args: {
    systemPrompt: string;
    userText: string;
    modelName: string;
    temperature: number;
    maxOutputTokens: number;
    steps: PreviewLogEntry[];
    articleLabel: string;
  }): Promise<{ text: string; usage: GeminiUsageMetadata | null; attempts: number }> {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      throw new BadRequestException('GEMINI_API_KEY is not configured on the server.');
    }
    const modelId = args.modelName.startsWith('models/')
      ? args.modelName
      : `models/${args.modelName}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: args.userText }] }],
      generationConfig: {
        temperature: args.temperature,
        maxOutputTokens: args.maxOutputTokens,
        responseMimeType: 'application/json',
      },
    };
    if (args.systemPrompt) {
      body.systemInstruction = { parts: [{ text: args.systemPrompt }] };
    }

    const maxAttempts = this.getGeminiPreviewMaxAttempts();
    const baseMs = this.getGeminiPreviewRetryBaseMs();
    let lastMessage = 'Gemini API error';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }

      if (!res.ok) {
        const err = data?.error as { message?: string; code?: number; status?: string } | undefined;
        lastMessage = err?.message ?? `Gemini API error: ${res.status}`;
        const retryable = this.isGeminiRateLimitResponse(res.status, data) && attempt < maxAttempts;
        if (retryable) {
          const backoff = Math.min(60_000, baseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 500));
          this.push(args.steps, 'warn', `${args.articleLabel}: Gemini rate limited; retrying.`, {
            http_status: res.status,
            attempt,
            max_attempts: maxAttempts,
            retry_in_ms: backoff,
            error_code: err?.code,
            error_status: err?.status,
          });
          await this.sleep(backoff);
          continue;
        }
        throw new Error(lastMessage);
      }

      const usage = this.pickUsageMetadata(data.usageMetadata);
      const candidates = data?.candidates as
        | Array<{ content?: { parts?: Array<{ text?: string }> } }>
        | undefined;
      const parts = candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p?.text ?? '').join('');
      if (!text) throw new Error('No text in Gemini response');
      if (attempt > 1) {
        this.push(args.steps, 'info', `${args.articleLabel}: Gemini succeeded after retry.`, {
          attempt,
          usage,
        });
      }
      return { text, usage, attempts: attempt };
    }

    throw new Error(lastMessage);
  }

  async run(body: MarketContentClassifierPreviewBody): Promise<MarketContentClassifierPreviewResult> {
    const steps: PreviewLogEntry[] = [];
    const results: ClassifiedArticleResult[] = [];

    const orgId = body.organization_id?.trim();
    if (!orgId) {
      throw new BadRequestException('organization_id is required');
    }

    this.push(steps, 'info', 'Starting market content classifier preview (FMP → Gemini).', {
      organization_id: orgId,
    });

    const prompt = await this.formulasService.getActiveMarketContentClassifierPrompt();
    if (!prompt?.system_prompt || !prompt.user_prompt_template) {
      this.push(steps, 'error', 'Active market_content_classifier prompt is missing.');
      return {
        steps,
        tickers_used: [],
        fmp_articles_considered: 0,
        results,
      };
    }
    this.push(steps, 'info', 'Loaded active prompt version from database.', {
      model_name: prompt.model_name,
      version: prompt.version,
    });

    const equityLimit = Math.min(500, Math.max(10, body.equity_page_limit ?? 80));
    const listQuery: ListOrgEquitiesQueryDto = {
      limit: equityLimit,
      offset: 0,
      q: body.equity_query?.trim() || undefined,
      cycle_horizon: body.cycle_horizon,
      sector_cycles: body.sector_cycles,
      industry_cycles: body.industry_cycles,
      sub_industry_cycles: body.sub_industry_cycles,
    };

    let tickers = this.normalizeTickers(body.ticker_symbols, 40);
    if (tickers.length === 0) {
      this.push(steps, 'info', 'No tickers supplied — loading organization equities (active universe).', {
        equity_limit: equityLimit,
      });
      const listed = await this.organizationEquitiesService.listEquities(orgId, listQuery);
      tickers = this.normalizeTickers(
        listed.items.map((r) => r.ticker),
        40,
      );
      this.push(steps, 'info', `Resolved ${tickers.length} tickers from org equities list.`, {
        total_count: listed.total_count,
      });
    } else {
      this.push(steps, 'info', `Using ${tickers.length} caller-selected tickers.`, { tickers });
    }

    if (tickers.length === 0) {
      this.push(steps, 'error', 'No tickers available. Pick symbols or widen org equity filters.');
      return { steps, tickers_used: [], fmp_articles_considered: 0, results };
    }

    const maxNews = Math.min(200, Math.max(5, body.max_news ?? 40));
    const classifyCount = Math.max(1, Math.floor(body.classify_count ?? 1));

    let articles: FmpNewsRow[] = [];
    try {
      const fmpUrlSafe = `${this.getFmpBaseUrl()}/stable/news/stock?symbols=<redacted>&from=…`;
      this.push(steps, 'info', 'Requesting stock news from FMP.', {
        url_pattern: fmpUrlSafe,
        ticker_count: tickers.length,
        max_news: maxNews,
      });
      articles = await this.fetchFmpStockNews(tickers, body.from, body.to, maxNews);
      this.push(steps, 'info', `FMP returned ${articles.length} news rows (after cap).`, {
        sample_titles: articles.slice(0, 3).map((a) => a.title ?? ''),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`FMP preview failed: ${msg}`);
      this.push(steps, 'error', `FMP fetch failed: ${msg}`);
      return { steps, tickers_used: tickers, fmp_articles_considered: 0, results };
    }

    const sortedArticles = [...articles].sort((a, b) => {
      const ta = Date.parse(String(a.publishedDate ?? ''));
      const tb = Date.parse(String(b.publishedDate ?? ''));
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });

    const entity_list = tickers
      .map((t) => `- entity_identifier: ${t}  (match this string exactly in JSON output)`)
      .join('\n');

    const toRun = sortedArticles.slice(0, classifyCount);
    this.push(steps, 'info', `Sending ${toRun.length} article(s) to Gemini for JSON classification.`, {
      classify_count: classifyCount,
    });

    const systemPrompt = prompt.system_prompt ?? '';
    const userTemplate = prompt.user_prompt_template ?? '';
    const modelName = prompt.model_name ?? 'gemini-2.0-flash';
    const temperature = typeof prompt.temperature === 'number' ? prompt.temperature : 0.2;
    const maxOutputTokens =
      typeof prompt.max_output_tokens === 'number' ? prompt.max_output_tokens : 8192;

    const shouldPersist = body.persist !== false;
    if (shouldPersist) {
      this.push(steps, 'info', 'Persist mode on: validated rows will be written to market_content*.');
    } else {
      this.push(steps, 'info', 'Persist mode off: Supabase tables will not be modified.');
    }

    for (let i = 0; i < toRun.length; i++) {
      const article = toRun[i];
      const sym = article.symbol ? String(article.symbol).toUpperCase() : null;
      const title = article.title ?? null;
      const rawText = article.text ?? article.description ?? '';
      const bodyText = rawText.length > 12000 ? `${rawText.slice(0, 12000)}\n\n[truncated]` : rawText;
      const publishedRaw = article.publishedDate ? String(article.publishedDate) : '';
      const publishedIso = publishedRaw ? new Date(publishedRaw).toISOString() : '';

      const vars: Record<string, string> = {
        source: 'fmp',
        content_type: 'news',
        title: title ?? '',
        summary: (article.description ?? article.text ?? '').slice(0, 4000),
        body: bodyText,
        url: article.url ?? '',
        published_at: publishedIso || publishedRaw,
        occurred_at: '',
        entity_list,
      };

      const userText = this.buildUserPrompt(userTemplate, vars);
      this.push(steps, 'info', `Gemini: classifying article ${i + 1}/${toRun.length}.`, {
        symbol: sym,
        title: title?.slice(0, 120),
      });

      const articleLabel = `Gemini article ${i + 1}/${toRun.length}`;
      try {
        const t0 = Date.now();
        const { text: rawJsonText, usage, attempts } = await this.callGeminiJson({
          systemPrompt,
          userText,
          modelName,
          temperature,
          maxOutputTokens,
          steps,
          articleLabel,
        });
        const ms = Date.now() - t0;
        let llmJson: Record<string, unknown> | null = null;
        try {
          llmJson = JSON.parse(rawJsonText) as Record<string, unknown>;
        } catch {
          this.push(steps, 'warn', `Gemini returned non-JSON text for article ${i + 1} (parse failed).`, {
            latency_ms: ms,
            usage,
          });
        }
        this.push(steps, 'info', `Gemini finished article ${i + 1} in ${ms}ms.`, {
          latency_ms: ms,
          attempts,
          usage,
          keys: llmJson ? Object.keys(llmJson) : [],
        });

        let persisted_market_content_id: string | null | undefined;
        let persist_error: string | null | undefined;
        let persist_replaced_existing: boolean | undefined;

        if (shouldPersist && llmJson) {
          const validated = validateMarketContentClassifierOutput(llmJson);
          if (!validated.ok) {
            persist_error = validated.errors.join('; ');
            this.push(steps, 'warn', `Article ${i + 1}: persist skipped (classifier JSON failed validation).`, {
              errors: validated.errors,
            });
          } else {
            try {
              const fmpPayload: Record<string, unknown> = { ...article };
              const out = await this.marketContentPersistence.persistClassifierOutput(
                validated.value,
                fmpPayload,
              );
              persisted_market_content_id = out.market_content_id;
              persist_replaced_existing = out.replaced_existing;
              this.push(steps, 'info', `Article ${i + 1}: persisted to Supabase.`, {
                market_content_id: out.market_content_id,
                replaced_existing: out.replaced_existing,
              });
            } catch (pe) {
              const pmsg = pe instanceof Error ? pe.message : String(pe);
              persist_error = pmsg;
              this.logger.warn(`Persist article ${i + 1}: ${pmsg}`);
              this.push(steps, 'error', `Article ${i + 1}: persist to Supabase failed.`, {
                message: pmsg,
              });
            }
          }
        } else if (shouldPersist && !llmJson) {
          persist_error = 'No parsed JSON to persist';
        }

        results.push({
          symbol: sym,
          title,
          published_at: publishedIso || publishedRaw || null,
          fmp_url: article.url ?? null,
          llm_json: llmJson,
          llm_raw_text: llmJson ? undefined : rawJsonText.slice(0, 4000),
          gemini_usage: usage,
          gemini_attempts: attempts,
          persisted_market_content_id: persisted_market_content_id ?? null,
          persist_error: persist_error ?? null,
          persist_replaced_existing,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.push(steps, 'error', `Gemini failed on article ${i + 1}: ${msg}`);
        results.push({
          symbol: sym,
          title,
          published_at: publishedIso || publishedRaw || null,
          fmp_url: article.url ?? null,
          llm_json: null,
          error: msg,
          gemini_usage: null,
          persisted_market_content_id: null,
          persist_error: shouldPersist ? 'Gemini failed before persist' : null,
        });
      }
    }

    this.push(steps, 'info', 'Preview run complete.');
    if (shouldPersist) {
      try {
        const windowMode = body.con51_aggregate_windows ?? 'both';
        const rollup = await this.eventFormulaRollupService.recompute(windowMode);
        this.push(steps, 'info', 'CON-51 rollup recompute complete.', {
          aggregate_windows: windowMode,
          entities: rollup.entities,
          upserts: rollup.upserts,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.push(steps, 'error', `CON-51 rollup recompute failed: ${msg}`);
      }
    }
    return {
      steps,
      tickers_used: tickers,
      fmp_articles_considered: articles.length,
      results,
    };
  }
}
