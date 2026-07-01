import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { expandFormulaKeyAliases } from '../lib/formula-key-aliases';
import { persistEntityFormulaScores } from '../lib/persist-formula-scores';
import {
  clamp,
  normalizeAmericaFirstLabel,
  parseAndNormalizeAmericaFirstPayload,
  type AmericaFirstControl,
  type AmericaFirstEconomicBenefit,
  type AmericaFirstLabel,
  type AmericaFirstLlmResult,
  type AmericaFirstPenalties,
  type AmericaFirstStrategicImportance,
} from './america-first-score-payload';

function toBreakdown(out: Pick<
  AmericaFirstLlmResult,
  'american_control' | 'american_economic_benefit' | 'strategic_importance' | 'penalties'
>) {
  return {
    american_control: out.american_control,
    american_economic_benefit: out.american_economic_benefit,
    strategic_importance: out.strategic_importance,
    penalties: out.penalties,
  };
}

const AMERICA_FIRST_FACTOR_KEY = 'america_first_score';
const AMERICA_FIRST_FORMULA_KEY = 'america_first_score';
const AMERICA_FIRST_PROMPT_KEY = 'america_first_score';
const AMERICA_FIRST_SOURCE = 'america_first_llm';
const AMERICA_FIRST_MODEL_VERSION = 'v1';
const AMERICA_FIRST_PERIOD_KEY = 'snapshot';

type SecurityTargetRow = {
  securityId: string;
  entityId: string;
  ticker: string;
  name: string | null;
};

export interface AmericaFirstScoreRow {
  ticker: string;
  score: number;
  label: AmericaFirstLabel;
  confidence: number;
  commentary: string;
  updatedAt: string | null;
  breakdown?: {
    american_control: AmericaFirstControl;
    american_economic_benefit: AmericaFirstEconomicBenefit;
    strategic_importance: AmericaFirstStrategicImportance;
    penalties: AmericaFirstPenalties;
  };
}

export interface AmericaFirstScoreCalculateResult {
  tickersRequested: number;
  tickersWithData: number;
  scoresWritten: number;
  errors: { ticker: string; message: string }[];
  scores: AmericaFirstScoreRow[];
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

@Injectable()
export class AmericaFirstScoreService {
  private readonly logger = new Logger(AmericaFirstScoreService.name);
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
    for (const key of expandFormulaKeyAliases(AMERICA_FIRST_PROMPT_KEY)) {
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
        maxOutputTokens: typeof pv.max_output_tokens === 'number' ? pv.max_output_tokens : 2048,
      };
    }
    return null;
  }

  private async callGeminiForTicker(
    target: SecurityTargetRow,
    prompt: {
      systemPrompt: string;
      userPromptTemplate: string;
      modelName: string;
      temperature: number;
      maxOutputTokens: number;
    },
  ): Promise<AmericaFirstLlmResult> {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
    const companyName = target.name?.trim() || target.ticker;
    let userText = (prompt.userPromptTemplate || '')
      .replace(/\{\{ticker\}\}/g, target.ticker)
      .replace(/\{\{company_name\}\}/g, companyName);
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
    const out = parseAndNormalizeAmericaFirstPayload(text);
    const llmParsed = JSON.parse(text.replace(/^```(?:json)?\s*([\s\S]*?)```$/m, '$1').trim()) as Record<
      string,
      unknown
    >;
    const llmScore = coerceNumber(llmParsed.score);
    if (llmScore != null && Math.abs(llmScore - out.score) > 0.01) {
      this.logger.warn(
        `America First score for ${target.ticker}: LLM reported ${llmScore}, using recomputed ${out.score}`,
      );
    }
    return out;
  }

  async calculateScores(options: {
    tickers?: string[];
    limit?: number;
    minScore?: number;
    maxScore?: number;
  }): Promise<AmericaFirstScoreCalculateResult> {
    const empty: AmericaFirstScoreCalculateResult = {
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
        message: 'Active America First prompt not found. Ensure prompt key america_first_score is seeded.',
      });
      return empty;
    }

    let factorRow: { id: string } | null = null;
    for (const key of expandFormulaKeyAliases(AMERICA_FIRST_FACTOR_KEY)) {
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
        message: `Factor ${AMERICA_FIRST_FACTOR_KEY} not found`,
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
    const formulaScoreRows: Array<{
      entity_id: string;
      score: number;
      explanation: Record<string, unknown>;
    }> = [];
    const scoreRows: AmericaFirstScoreRow[] = [];
    const now = new Date().toISOString();
    for (const t of targets) {
      try {
        const out = await this.callGeminiForTicker(t, prompt);
        upsertRows.push({
          entity_id: t.entityId,
          factor_id: factorRow.id as string,
          value_num: out.score,
          value_text: JSON.stringify(out),
          updated_at: now,
          source: AMERICA_FIRST_SOURCE,
          ingested_at: now,
          model_version: AMERICA_FIRST_MODEL_VERSION,
          period_key: AMERICA_FIRST_PERIOD_KEY,
        });
        formulaScoreRows.push({
          entity_id: t.entityId,
          score: out.score,
          explanation: {
            commentary: out.commentary,
            label: out.label,
            confidence: out.confidence,
            american_control: out.american_control,
            american_economic_benefit: out.american_economic_benefit,
            strategic_importance: out.strategic_importance,
            penalties: out.penalties,
          },
        });
        scoreRows.push({
          ticker: t.ticker,
          score: out.score,
          label: out.label,
          confidence: out.confidence,
          commentary: out.commentary,
          updatedAt: now,
          breakdown: toBreakdown(out),
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

    if (formulaScoreRows.length > 0) {
      try {
        await persistEntityFormulaScores(this.adminClient, AMERICA_FIRST_FORMULA_KEY, formulaScoreRows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        empty.errors.push({ ticker: '_', message: msg });
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
  }): Promise<AmericaFirstScoreCalculateResult> {
    const empty: AmericaFirstScoreCalculateResult = {
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
      .from('v_security_america_first_scores')
      .select(
        'ticker, america_first_score, america_first_label, america_first_confidence, america_first_commentary, america_first_updated_at, america_first_payload_text',
      )
      .order('america_first_score', { ascending: false });
    if (options.tickers?.length) {
      q = q.in('ticker', options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
    }
    if (options.minScore != null && Number.isFinite(options.minScore)) {
      q = q.gte('america_first_score', options.minScore);
    }
    if (options.maxScore != null && Number.isFinite(options.maxScore)) {
      q = q.lte('america_first_score', options.maxScore);
    }
    if (options.limit != null && options.limit > 0) q = q.limit(options.limit);
    const { data, error } = await q;
    if (error) {
      empty.errors.push({ ticker: '_', message: `Failed to load America First scores: ${error.message}` });
      return empty;
    }
    const rows = ((data ?? []) as Record<string, unknown>[])
      .filter((r) => typeof r.ticker === 'string' && coerceNumber(r.america_first_score) != null)
      .map((r) => {
        const s = coerceNumber(r.america_first_score) ?? 0;
        const label =
          typeof r.america_first_label === 'string' ? r.america_first_label : normalizeAmericaFirstLabel(s);
        let breakdown: AmericaFirstScoreRow['breakdown'];
        const payloadText = r.america_first_payload_text;
        if (typeof payloadText === 'string' && payloadText.trim()) {
          try {
            const parsed = parseAndNormalizeAmericaFirstPayload(payloadText);
            breakdown = toBreakdown(parsed);
          } catch {
            breakdown = undefined;
          }
        }
        return {
          ticker: String(r.ticker),
          score: Math.round(s * 100) / 100,
          label: (label === 'positive' || label === 'neutral' || label === 'negative'
            ? label
            : normalizeAmericaFirstLabel(s)) as AmericaFirstLabel,
          confidence: clamp(coerceNumber(r.america_first_confidence) ?? 0, 0, 1),
          commentary: typeof r.america_first_commentary === 'string' ? r.america_first_commentary : '',
          updatedAt: r.america_first_updated_at != null ? String(r.america_first_updated_at) : null,
          breakdown,
        };
      });
    empty.tickersRequested = rows.length;
    empty.tickersWithData = rows.length;
    empty.scores = rows;
    return empty;
  }
}
