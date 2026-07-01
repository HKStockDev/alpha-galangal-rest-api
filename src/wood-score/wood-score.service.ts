import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { expandFormulaKeyAliases } from '../lib/formula-key-aliases';

const WOOD_FACTOR_KEY = 'wood_score';
const WOOD_PROMPT_KEY = 'wood_score';
const WOOD_SOURCE = 'wood_llm';
const WOOD_MODEL_VERSION = 'v1';
const WOOD_PERIOD_KEY = 'snapshot';

type SecurityTargetRow = {
  securityId: string;
  entityId: string;
  ticker: string;
  name: string | null;
};

type WoodLlmResult = {
  model?: string;
  score: number;
  label: 'positive' | 'neutral' | 'negative';
  confidence: number;
  dimensions: {
    innovation_exposure: number;
    technology_leverage: number;
    future_market_expansion: number;
    disruption_potential: number;
  };
  reasons_for: string[];
  reasons_against: string[];
  summary: string;
};

export interface WoodScoreRow {
  ticker: string;
  score: number;
  label: 'positive' | 'neutral' | 'negative';
  confidence: number;
  summary: string;
  updatedAt: string | null;
}

export interface WoodScoreCalculateResult {
  tickersRequested: number;
  tickersWithData: number;
  scoresWritten: number;
  errors: { ticker: string; message: string }[];
  scores: WoodScoreRow[];
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeLabel(score: number): 'positive' | 'neutral' | 'negative' {
  if (score >= 70) return 'positive';
  if (score >= 40) return 'neutral';
  return 'negative';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

@Injectable()
export class WoodScoreService {
  private readonly logger = new Logger(WoodScoreService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private getGeminiApiKey(): string | undefined {
    return (
      this.config.get<string>('gemini.apiKey') ??
      this.config.get<string>('GEMINI_API_KEY') ??
      process.env.GEMINI_API_KEY
    );
  }

  private async loadTargets(options: {
    tickers?: string[];
    limit?: number;
  }): Promise<{ rows: SecurityTargetRow[]; error?: string }> {
    if (!this.adminClient) return { rows: [] };
    let q = this.adminClient
      .from('securities')
      .select('id, entity_id, ticker, name')
      .eq('active', true)
      .not('entity_id', 'is', null);
    if (options.tickers?.length) {
      q = q.in(
        'ticker',
        options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean),
      );
    }
    if (options.limit != null && options.limit > 0) q = q.limit(options.limit);
    const { data, error } = await q;
    if (error) {
      return { rows: [], error: `Failed to load securities: ${error.message}` };
    }
    const rows = (data ?? [])
      .filter((r: Record<string, unknown>) => r.id && r.entity_id && r.ticker)
      .map((r: Record<string, unknown>) => ({
        securityId: String(r.id),
        entityId: String(r.entity_id),
        ticker: String(r.ticker).trim().toUpperCase(),
        name: r.name != null ? String(r.name) : null,
      }));
    return { rows };
  }

  private async getActivePromptVersion(): Promise<{
    systemPrompt: string;
    userPromptTemplate: string;
    modelName: string;
    temperature: number;
    maxOutputTokens: number;
  } | null> {
    if (!this.adminClient) return null;
    for (const key of expandFormulaKeyAliases(WOOD_PROMPT_KEY)) {
      const { data: promptRow } = await this.adminClient
        .from('prompts')
        .select('id, active_prompt_version_id')
        .eq('key', key)
        .maybeSingle();
      const activeId = promptRow?.active_prompt_version_id;
      if (!activeId) continue;
      const { data: pv } = await this.adminClient
        .from('prompt_versions')
        .select('system_prompt, user_prompt_template, model_name, temperature, max_output_tokens')
        .eq('id', activeId)
        .maybeSingle();
      if (!pv) continue;
      return {
        systemPrompt: pv.system_prompt ?? '',
        userPromptTemplate: pv.user_prompt_template ?? '',
        modelName: pv.model_name ?? 'gemini-2.5-flash',
        temperature: typeof pv.temperature === 'number' ? pv.temperature : 0.2,
        maxOutputTokens: typeof pv.max_output_tokens === 'number' ? pv.max_output_tokens : 1024,
      };
    }
    return null;
  }

  private parseAndNormalizeLlmPayload(rawText: string): WoodLlmResult {
    let raw = rawText.trim();
    const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
    if (codeBlock) raw = codeBlock[1].trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawScore = coerceNumber(parsed.score);
    if (rawScore == null) throw new Error('LLM response missing numeric score');
    const score = Math.round(clamp(rawScore, 0, 100) * 100) / 100;
    const confidenceRaw = coerceNumber(parsed.confidence) ?? 0.5;
    const confidence = Math.round(clamp(confidenceRaw, 0, 1) * 10000) / 10000;
    const dimensions = (parsed.dimensions ?? {}) as Record<string, unknown>;
    const dim = {
      innovation_exposure: clamp(coerceNumber(dimensions.innovation_exposure) ?? 0, 0, 100),
      technology_leverage: clamp(coerceNumber(dimensions.technology_leverage) ?? 0, 0, 100),
      future_market_expansion: clamp(coerceNumber(dimensions.future_market_expansion) ?? 0, 0, 100),
      disruption_potential: clamp(coerceNumber(dimensions.disruption_potential) ?? 0, 0, 100),
    };
    const reasonsFor = Array.isArray(parsed.reasons_for)
      ? parsed.reasons_for.filter((x): x is string => typeof x === 'string')
      : [];
    const reasonsAgainst = Array.isArray(parsed.reasons_against)
      ? parsed.reasons_against.filter((x): x is string => typeof x === 'string')
      : [];
    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    return {
      model: typeof parsed.model === 'string' ? parsed.model : 'cathie_wood',
      score,
      label: normalizeLabel(score),
      confidence,
      dimensions: dim,
      reasons_for: reasonsFor,
      reasons_against: reasonsAgainst,
      summary,
    };
  }

  private async callGeminiForTicker(
    ticker: string,
    prompt: {
      systemPrompt: string;
      userPromptTemplate: string;
      modelName: string;
      temperature: number;
      maxOutputTokens: number;
    },
  ): Promise<WoodLlmResult> {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
    const userText = (prompt.userPromptTemplate || '').replace(/\{\{ticker\}\}/g, ticker);
    const modelId = prompt.modelName.startsWith('models/')
      ? prompt.modelName
      : `models/${prompt.modelName}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: prompt.temperature,
        maxOutputTokens: prompt.maxOutputTokens,
        responseMimeType: 'application/json',
      },
    };
    if (prompt.systemPrompt) {
      body.systemInstruction = { parts: [{ text: prompt.systemPrompt }] };
    }
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
      const err = data?.error as { message?: string } | undefined;
      throw new Error(err?.message ?? `Gemini API error: ${res.status}`);
    }
    const candidates = data?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    const parts = candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p: { text?: string }) => p?.text ?? '').join('');
    if (!text) throw new Error('No text in Gemini response');
    return this.parseAndNormalizeLlmPayload(text);
  }

  async calculateScores(options: {
    tickers?: string[];
    limit?: number;
    minScore?: number;
    maxScore?: number;
  }): Promise<WoodScoreCalculateResult> {
    const empty: WoodScoreCalculateResult = {
      tickersRequested: 0,
      tickersWithData: 0,
      scoresWritten: 0,
      errors: [],
      scores: [],
    };
    if (!this.adminClient) {
      empty.errors.push({ ticker: '_', message: 'Supabase not configured' });
      return empty;
    }

    const prompt = await this.getActivePromptVersion();
    if (!prompt) {
      empty.errors.push({
        ticker: '_',
        message: 'Active Wood prompt not found. Ensure prompt key wood_score is seeded.',
      });
      return empty;
    }

    let factorRow: { id: string } | null = null;
    for (const key of expandFormulaKeyAliases(WOOD_FACTOR_KEY)) {
      const { data: row } = await this.adminClient
        .from('factors')
        .select('id')
        .eq('key', key)
        .maybeSingle();
      if (row?.id) {
        factorRow = { id: String(row.id) };
        break;
      }
    }
    if (!factorRow?.id) {
      empty.errors.push({
        ticker: '_',
        message: `Factor ${WOOD_FACTOR_KEY} not found`,
      });
      return empty;
    }

    const { rows: targets, error: targetsErr } = await this.loadTargets(options);
    if (targetsErr) {
      empty.errors.push({ ticker: '_', message: targetsErr });
      return empty;
    }
    empty.tickersRequested = targets.length;
    if (targets.length === 0) return empty;

    const upsertRows: Record<string, unknown>[] = [];
    const scoreRows: WoodScoreRow[] = [];
    const now = new Date().toISOString();
    for (const t of targets) {
      try {
        const out = await this.callGeminiForTicker(t.ticker, prompt);
        upsertRows.push({
          entity_id: t.entityId,
          factor_id: factorRow.id as string,
          value_num: out.score,
          value_text: JSON.stringify(out),
          updated_at: now,
          source: WOOD_SOURCE,
          ingested_at: now,
          model_version: WOOD_MODEL_VERSION,
          period_key: WOOD_PERIOD_KEY,
        });
        scoreRows.push({
          ticker: t.ticker,
          score: out.score,
          label: out.label,
          confidence: out.confidence,
          summary: out.summary,
          updatedAt: now,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        empty.errors.push({ ticker: t.ticker, message: msg });
      }
    }

    for (const chunk of chunkArray(upsertRows, 100)) {
      const { error } = await this.adminClient
        .from('entity_factor_values')
        .upsert(chunk, {
          onConflict: 'entity_id,factor_id,model_version,period_key',
        });
      if (error) {
        empty.errors.push({ ticker: '_', message: `entity_factor_values upsert failed: ${error.message}` });
      } else {
        empty.scoresWritten += chunk.length;
      }
    }

    let filtered = scoreRows;
    if (options.minScore != null && Number.isFinite(options.minScore)) {
      filtered = filtered.filter((r) => r.score >= options.minScore!);
    }
    if (options.maxScore != null && Number.isFinite(options.maxScore)) {
      filtered = filtered.filter((r) => r.score <= options.maxScore!);
    }
    filtered.sort((a, b) => b.score - a.score);
    empty.tickersWithData = scoreRows.length;
    empty.scores = filtered;
    return empty;
  }

  async loadCurrentScores(options: {
    tickers?: string[];
    limit?: number;
    minScore?: number;
    maxScore?: number;
  }): Promise<WoodScoreCalculateResult> {
    const empty: WoodScoreCalculateResult = {
      tickersRequested: 0,
      tickersWithData: 0,
      scoresWritten: 0,
      errors: [],
      scores: [],
    };
    if (!this.adminClient) {
      empty.errors.push({ ticker: '_', message: 'Supabase not configured' });
      return empty;
    }
    let q = this.adminClient
      .from('v_security_wood_scores')
      .select('ticker, wood_score, wood_label, wood_confidence, wood_summary, wood_updated_at')
      .order('wood_score', { ascending: false });
    if (options.tickers?.length) {
      q = q.in('ticker', options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
    }
    if (options.minScore != null && Number.isFinite(options.minScore)) q = q.gte('wood_score', options.minScore);
    if (options.maxScore != null && Number.isFinite(options.maxScore)) q = q.lte('wood_score', options.maxScore);
    if (options.limit != null && options.limit > 0) q = q.limit(options.limit);
    const { data, error } = await q;
    if (error) {
      empty.errors.push({ ticker: '_', message: `Failed to load Wood scores: ${error.message}` });
      return empty;
    }
    const rows = ((data ?? []) as Record<string, unknown>[])
      .filter((r) => typeof r.ticker === 'string' && coerceNumber(r.wood_score) != null)
      .map((r) => {
        const s = coerceNumber(r.wood_score) ?? 0;
        const label = typeof r.wood_label === 'string' ? r.wood_label : normalizeLabel(s);
        return {
          ticker: String(r.ticker),
          score: Math.round(s * 100) / 100,
          label: (label === 'positive' || label === 'neutral' || label === 'negative'
            ? label
            : normalizeLabel(s)) as 'positive' | 'neutral' | 'negative',
          confidence: clamp(coerceNumber(r.wood_confidence) ?? 0, 0, 1),
          summary: typeof r.wood_summary === 'string' ? r.wood_summary : '',
          updatedAt: r.wood_updated_at != null ? String(r.wood_updated_at) : null,
        };
      });
    empty.tickersRequested = rows.length;
    empty.tickersWithData = rows.length;
    empty.scores = rows;
    return empty;
  }
}
