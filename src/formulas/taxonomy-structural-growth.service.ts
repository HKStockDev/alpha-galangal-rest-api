import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const PROMPT_KEY_BY_HORIZON: Record<'3y' | '5y' | '10y', string> = {
  '3y': 'taxonomy_structural_growth_3y',
  '5y': 'taxonomy_structural_growth_5y',
  '10y': 'taxonomy_structural_growth_10y',
};

const FACTOR_KEY_BY_LEVEL: Record<string, string> = {
  sector: 'sector_structural_growth',
  industry: 'industry_structural_growth',
  sub_industry: 'sub_industry_structural_growth',
};

/** Horizon bucket scores (0–100) + composite; shared across taxonomy entity types. */
const SCORE_FACTOR_KEYS = {
  '3y': 'sg_cagr_score_3y',
  '5y': 'sg_cagr_score_5y',
  '10y': 'sg_cagr_score_10y',
} as const;

const COMPOSITE_FACTOR_KEY = 'sg_cagr_composite_score';

export const TAXONOMY_STRUCTURAL_GROWTH_CAGR_FORMULA_KEY = 'taxonomy_structural_growth_cagr_score';

type CagrWeights = {
  sg_cagr_score_3y: number;
  sg_cagr_score_5y: number;
  sg_cagr_score_10y: number;
};

const DEFAULT_CAGR_WEIGHTS: CagrWeights = {
  sg_cagr_score_3y: 0.2,
  sg_cagr_score_5y: 0.3,
  sg_cagr_score_10y: 0.5,
};

const HORIZON_META: { periodKey: '3y' | '5y' | '10y'; periodMonths: number }[] = [
  { periodKey: '3y', periodMonths: 36 },
  { periodKey: '5y', periodMonths: 60 },
  { periodKey: '10y', periodMonths: 120 },
];

/** Map LLM cagr_bucket string to a 0–100 score (deterministic). */
export function cagrBucketToScore(bucket: unknown): number {
  if (typeof bucket !== 'string') return 50;
  const b = bucket.trim().toLowerCase();
  if (b.includes('declin')) return 15;
  if (b.includes('20%+') || /\b20\s*%\+/.test(b)) return 95;
  if (b.includes('10–20') || b.includes('10-20') || b.includes('10 to 20')) return 72;
  if (b.includes('5–10') || b.includes('5-10') || b.includes('5 to 10')) return 45;
  if (b.includes('0–5') || b.includes('0-5') || b.includes('0 to 5')) return 28;
  return 50;
}

export interface TaxonomyStructuralGrowthRunResult {
  entitiesProcessed: number;
  llmCalls: number;
  errors: string[];
}

export interface TaxonomyStructuralGrowthCagrSyncResult {
  entitiesScanned: number;
  horizonScoresUpserted: number;
  compositesUpserted: number;
  entitiesWithAllHorizons: number;
  entitiesMissingAnyHorizon: number;
  errors: string[];
}

export type TaxonomyEntityTypeFilter = 'sector' | 'industry' | 'sub_industry';

export interface TaxonomyCagrScoreRow {
  entityId: string;
  entityType: string;
  taxonomyNodeId: string;
  title: string | null;
  code: string | null;
  score3y: number | null;
  score5y: number | null;
  score10y: number | null;
  composite: number | null;
  scoresUpdatedAt: string | null;
}

export interface TaxonomyCagrScoresReadModel {
  summary: {
    totalTaxonomyEntities: number;
    tableShown: number;
    withAllHorizonsInTable: number;
    withCompositeInTable: number;
    lastScoreUpdateAt: string | null;
  };
  rows: TaxonomyCagrScoreRow[];
}

type PromptVersionRow = {
  system_prompt: string | null;
  user_prompt_template: string | null;
  model_name: string | null;
  temperature: number | null;
  max_output_tokens: number | null;
};

function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), (v ?? '').toString());
  }
  return out;
}

function parseGeminiJson(text: string): Record<string, unknown> {
  let raw = text.trim();
  const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (codeBlock) raw = codeBlock[1].trim();
  return JSON.parse(raw) as Record<string, unknown>;
}

function parseValueTextJson(valueText: unknown): Record<string, unknown> | null {
  if (typeof valueText !== 'string') return null;
  const raw = valueText.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isRetryableGeminiRateLimit(status: number, message: string): boolean {
  if (status === 429) return true;
  const m = message.toLowerCase();
  return (
    m.includes('resource exhausted') ||
    m.includes('quota') ||
    m.includes('rate limit') ||
    m.includes('too many requests')
  );
}

function geminiRetryDelayMs(attemptIndex: number, res: Response): number {
  const ra = res.headers.get('retry-after');
  if (ra) {
    const n = parseFloat(ra.trim());
    if (Number.isFinite(n) && n > 0) {
      const ms = n < 200 ? n * 1000 : n;
      return Math.min(Math.max(Math.round(ms), 1000), 120_000);
    }
  }
  const base = 2000 * 2 ** attemptIndex;
  return Math.min(60_000, base) + Math.floor(Math.random() * 500);
}

@Injectable()
export class TaxonomyStructuralGrowthService {
  private readonly logger = new Logger(TaxonomyStructuralGrowthService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {
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

  getRunStatus(): { geminiConfigured: boolean } {
    return { geminiConfigured: !!this.getGeminiApiKey() };
  }

  /**
   * One minimal generateContent to verify GEMINI_API_KEY and network (Google AI / Gemini API).
   * Usage metrics appear under Google AI Studio for API keys, not the Vertex-only dashboard.
   */
  async testGeminiConnectivity(): Promise<{
    ok: boolean;
    latencyMs: number;
    model: string;
    error?: string;
  }> {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        model: '',
        error: 'GEMINI_API_KEY is not configured on the API server',
      };
    }
    const model = 'models/gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: pong' }] }],
          generationConfig: { maxOutputTokens: 32, temperature: 0 },
        }),
      });
      const data = (await res.json()) as {
        error?: { message?: string };
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return {
          ok: false,
          latencyMs,
          model,
          error: data?.error?.message ?? res.statusText,
        };
      }
      const text =
        data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('').trim() ?? '';
      if (!text) {
        return { ok: false, latencyMs, model, error: 'Empty response from Gemini' };
      }
      this.logger.log(`Gemini connectivity test succeeded in ${latencyMs}ms (${model})`);
      return { ok: true, latencyMs, model };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        model,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async loadActivePromptVersion(promptKey: string): Promise<PromptVersionRow | null> {
    if (!this.adminClient) return null;
    const { data: prompt, error: pErr } = await this.adminClient
      .from('prompts')
      .select('active_prompt_version_id')
      .eq('key', promptKey)
      .maybeSingle();
    if (pErr || !prompt?.active_prompt_version_id) return null;
    const { data: pv, error: pvErr } = await this.adminClient
      .from('prompt_versions')
      .select('system_prompt, user_prompt_template, model_name, temperature, max_output_tokens')
      .eq('id', prompt.active_prompt_version_id)
      .single();
    if (pvErr || !pv) return null;
    return pv as PromptVersionRow;
  }

  private async runGemini(
    apiKey: string,
    promptVersion: PromptVersionRow,
    templateVars: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const userText = fillTemplate(promptVersion.user_prompt_template ?? '', templateVars);
    const systemText = promptVersion.system_prompt ?? '';
    const modelRaw = promptVersion.model_name || 'gemini-2.0-flash';
    const model = modelRaw.startsWith('models/') ? modelRaw : `models/${modelRaw}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: promptVersion.temperature ?? 0.2,
        maxOutputTokens: promptVersion.max_output_tokens ?? 1024,
        responseMimeType: 'application/json',
      },
    };
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }
    const payload = JSON.stringify(body);
    const maxAttempts = 7;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      const data = (await res.json()) as {
        error?: { message?: string };
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      if (!res.ok) {
        const msg = data?.error?.message || res.statusText;
        if (isRetryableGeminiRateLimit(res.status, msg) && attempt < maxAttempts - 1) {
          const waitMs = geminiRetryDelayMs(attempt, res);
          this.logger.warn(
            `Gemini rate limited (${res.status}): ${msg} — retry in ${waitMs}ms (${attempt + 1}/${maxAttempts})`,
          );
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(msg);
      }
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p?.text || '').join('').trim();
      if (!text) throw new Error('Empty Gemini response');
      return parseGeminiJson(text);
    }
    throw new Error('Gemini failed after retries');
  }

  private normalizePayload(
    raw: Record<string, unknown>,
    expectedHorizon: '3y' | '5y' | '10y',
  ): Record<string, unknown> {
    const out = { ...raw };
    out.horizon = expectedHorizon;
    const cs = out.cycle_signal;
    if (typeof cs === 'number' && cs !== -1 && cs !== 0 && cs !== 1) {
      out.cycle_signal = Math.max(-1, Math.min(1, Math.round(cs)));
    }
    return out;
  }

  private async fetchCagrWeights(): Promise<CagrWeights> {
    if (!this.adminClient) return { ...DEFAULT_CAGR_WEIGHTS };
    const { data, error } = await this.adminClient
      .from('formulas')
      .select('definition')
      .eq('key', TAXONOMY_STRUCTURAL_GROWTH_CAGR_FORMULA_KEY)
      .maybeSingle();
    if (error || !data?.definition) return { ...DEFAULT_CAGR_WEIGHTS };
    const def = data.definition as { type?: string; weights?: Partial<CagrWeights> };
    const w = def?.weights;
    if (!w) return { ...DEFAULT_CAGR_WEIGHTS };
    return {
      sg_cagr_score_3y: w.sg_cagr_score_3y ?? DEFAULT_CAGR_WEIGHTS.sg_cagr_score_3y,
      sg_cagr_score_5y: w.sg_cagr_score_5y ?? DEFAULT_CAGR_WEIGHTS.sg_cagr_score_5y,
      sg_cagr_score_10y: w.sg_cagr_score_10y ?? DEFAULT_CAGR_WEIGHTS.sg_cagr_score_10y,
    };
  }

  private compositeValue(weights: CagrWeights, s3: number, s5: number, s10: number): number {
    return (
      weights.sg_cagr_score_3y * s3 +
      weights.sg_cagr_score_5y * s5 +
      weights.sg_cagr_score_10y * s10
    );
  }

  private async resolveCagrFactorIds(): Promise<{
    id3: string;
    id5: string;
    id10: string;
    idComp: string;
  } | null> {
    if (!this.adminClient) return null;
    const scoreKeys = [SCORE_FACTOR_KEYS['3y'], SCORE_FACTOR_KEYS['5y'], SCORE_FACTOR_KEYS['10y']];
    const { data: factorRows, error: fErr } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', [...scoreKeys, COMPOSITE_FACTOR_KEY]);
    if (fErr || !factorRows?.length) return null;
    const factorIdByKey = Object.fromEntries(
      factorRows.map((f: { id: string; key: string }) => [f.key, f.id]),
    );
    const id3 = factorIdByKey[SCORE_FACTOR_KEYS['3y']];
    const id5 = factorIdByKey[SCORE_FACTOR_KEYS['5y']];
    const id10 = factorIdByKey[SCORE_FACTOR_KEYS['10y']];
    const idComp = factorIdByKey[COMPOSITE_FACTOR_KEY];
    if (!id3 || !id5 || !id10 || !idComp) return null;
    return { id3, id5, id10, idComp };
  }

  /**
   * Read taxonomy nodes with persisted CAGR bucket scores / composite (for org dashboards).
   */
  async getCagrScoresReadModel(options?: {
    limit?: number;
    entityType?: TaxonomyEntityTypeFilter;
  }): Promise<TaxonomyCagrScoresReadModel> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }
    const rawLimit = options?.limit;
    const limit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), 2000)
        : 500;

    const ids = await this.resolveCagrFactorIds();
    if (!ids) {
      return {
        summary: {
          totalTaxonomyEntities: 0,
          tableShown: 0,
          withAllHorizonsInTable: 0,
          withCompositeInTable: 0,
          lastScoreUpdateAt: null,
        },
        rows: [],
      };
    }
    const { id3, id5, id10, idComp } = ids;
    const factorIds = [id3, id5, id10, idComp];
    const keyByFactorId = new Map<string, '3y' | '5y' | '10y' | 'comp'>([
      [id3, '3y'],
      [id5, '5y'],
      [id10, '10y'],
      [idComp, 'comp'],
    ]);

    const types: TaxonomyEntityTypeFilter[] = options?.entityType
      ? [options.entityType]
      : ['sector', 'industry', 'sub_industry'];

    const { count: totalTaxonomyEntities, error: countErr } = await this.adminClient
      .from('entities')
      .select('*', { count: 'exact', head: true })
      .in('entity_type', types)
      .not('taxonomy_node_id', 'is', null);

    if (countErr) {
      throw new Error(`Failed to count taxonomy entities: ${countErr.message}`);
    }

    const total = totalTaxonomyEntities ?? 0;
    if (total === 0) {
      return {
        summary: {
          totalTaxonomyEntities: 0,
          tableShown: 0,
          withAllHorizonsInTable: 0,
          withCompositeInTable: 0,
          lastScoreUpdateAt: null,
        },
        rows: [],
      };
    }

    const poolSize =
      total <= 0
        ? 0
        : total <= 3000
          ? total
          : Math.min(total, Math.max(limit * 5, 2000), 6000);

    let entQuery = this.adminClient
      .from('entities')
      .select('id, entity_type, taxonomy_node_id')
      .in('entity_type', types)
      .not('taxonomy_node_id', 'is', null);

    if (poolSize > 0) {
      entQuery = entQuery.limit(poolSize);
    }

    const { data: entRows, error: entErr } = await entQuery;

    if (entErr) {
      throw new Error(`Failed to load taxonomy entities: ${entErr.message}`);
    }

    let ents = (entRows ?? []) as {
      id: string;
      entity_type: string;
      taxonomy_node_id: string;
    }[];
    const entityIds = ents.map((e) => e.id);
    const nodeIds = [...new Set(ents.map((e) => e.taxonomy_node_id))];

    const { data: nodes, error: nodeErr } = await this.adminClient
      .from('taxonomy_nodes')
      .select('node_id, title, code')
      .in('node_id', nodeIds);

    if (nodeErr) {
      throw new Error(`Failed to load taxonomy nodes: ${nodeErr.message}`);
    }

    const nodeById = new Map(
      (nodes ?? []).map((n: { node_id: string; title: string | null; code: string | null }) => [
        n.node_id,
        n,
      ]),
    );

    ents.sort((a, b) => {
      const na = nodeById.get(a.taxonomy_node_id);
      const nb = nodeById.get(b.taxonomy_node_id);
      const ta = (na?.title ?? na?.code ?? a.taxonomy_node_id).toLowerCase();
      const tb = (nb?.title ?? nb?.code ?? b.taxonomy_node_id).toLowerCase();
      if (ta !== tb) return ta.localeCompare(tb);
      return a.entity_type.localeCompare(b.entity_type);
    });
    ents = ents.slice(0, limit);

    type Cell = { value: number; updatedAt: string | null };
    const scoresByEntity = new Map<
      string,
      Partial<Record<'3y' | '5y' | '10y' | 'comp', Cell>>
    >();

    const chunkSize = 120;
    for (let i = 0; i < entityIds.length; i += chunkSize) {
      const chunk = entityIds.slice(i, i + chunkSize);
      const { data: vals, error: vErr } = await this.adminClient
        .from('entity_factor_values')
        .select('entity_id, factor_id, value_num, updated_at')
        .eq('model_version', 'v1')
        .eq('period_key', 'na')
        .in('factor_id', factorIds)
        .in('entity_id', chunk);
      if (vErr) {
        throw new Error(`Failed to load CAGR scores: ${vErr.message}`);
      }
      for (const row of vals ?? []) {
        const r = row as {
          entity_id: string;
          factor_id: string;
          value_num: number | null;
          updated_at: string | null;
        };
        const slot = keyByFactorId.get(r.factor_id);
        if (!slot || r.value_num === null || Number.isNaN(r.value_num)) continue;
        let m = scoresByEntity.get(r.entity_id);
        if (!m) {
          m = {};
          scoresByEntity.set(r.entity_id, m);
        }
        m[slot] = { value: r.value_num, updatedAt: r.updated_at };
      }
    }

    const { data: lastRow } = await this.adminClient
      .from('entity_factor_values')
      .select('updated_at')
      .in('factor_id', factorIds)
      .eq('model_version', 'v1')
      .eq('period_key', 'na')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastScoreUpdateAt =
      (lastRow as { updated_at?: string } | null)?.updated_at ?? null;

    const rows: TaxonomyCagrScoreRow[] = ents.map((e) => {
      const node = nodeById.get(e.taxonomy_node_id);
      const sc = scoresByEntity.get(e.id);
      const c3 = sc?.['3y'];
      const c5 = sc?.['5y'];
      const c10 = sc?.['10y'];
      const cc = sc?.comp;
      const dates = [c3?.updatedAt, c5?.updatedAt, c10?.updatedAt, cc?.updatedAt].filter(
        Boolean,
      ) as string[];
      const scoresUpdatedAt =
        dates.length === 0
          ? null
          : dates.reduce((a, b) => (a > b ? a : b));

      return {
        entityId: e.id,
        entityType: e.entity_type,
        taxonomyNodeId: e.taxonomy_node_id,
        title: node?.title ?? null,
        code: node?.code ?? null,
        score3y: c3?.value ?? null,
        score5y: c5?.value ?? null,
        score10y: c10?.value ?? null,
        composite: cc?.value ?? null,
        scoresUpdatedAt,
      };
    });

    let withAllHorizonsInTable = 0;
    let withCompositeInTable = 0;
    for (const r of rows) {
      if (
        r.score3y !== null &&
        r.score5y !== null &&
        r.score10y !== null
      ) {
        withAllHorizonsInTable += 1;
      }
      if (r.composite !== null) withCompositeInTable += 1;
    }

    return {
      summary: {
        totalTaxonomyEntities: totalTaxonomyEntities ?? 0,
        tableShown: rows.length,
        withAllHorizonsInTable,
        withCompositeInTable,
        lastScoreUpdateAt,
      },
      rows,
    };
  }

  /**
   * Recompute sg_cagr_composite_score for every taxonomy entity that has all three horizon scores.
   */
  async recalculateAllCagrComposites(): Promise<{ entitiesUpdated: number }> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }
    const weights = await this.fetchCagrWeights();
    const resolved = await this.resolveCagrFactorIds();
    if (!resolved) {
      throw new Error('CAGR score factors not found. Apply migration 20260409120000_structural_growth_cagr_score_factors_formula.');
    }
    const { id3, id5, id10, idComp } = resolved;

    const { data: vals, error: vErr } = await this.adminClient
      .from('entity_factor_values')
      .select('entity_id, factor_id, value_num')
      .eq('model_version', 'v1')
      .eq('period_key', 'na')
      .in('factor_id', [id3, id5, id10])
      .not('value_num', 'is', null);
    if (vErr) {
      throw new Error(`Failed to load horizon scores: ${vErr.message}`);
    }

    const rev = new Map<string, string>([
      [id3, '3y'],
      [id5, '5y'],
      [id10, '10y'],
    ]);
    const byEntity = new Map<string, Partial<Record<'3y' | '5y' | '10y', number>>>();
    for (const row of vals ?? []) {
      const r = row as { entity_id: string; factor_id: string; value_num: number };
      const hk = rev.get(r.factor_id);
      if (hk !== '3y' && hk !== '5y' && hk !== '10y') continue;
      let m = byEntity.get(r.entity_id);
      if (!m) {
        m = {};
        byEntity.set(r.entity_id, m);
      }
      m[hk] = r.value_num;
    }

    let entitiesUpdated = 0;
    const now = new Date().toISOString();
    for (const [entityId, m] of byEntity) {
      if (m['3y'] === undefined || m['5y'] === undefined || m['10y'] === undefined) continue;
      const composite = this.compositeValue(weights, m['3y']!, m['5y']!, m['10y']!);
      const { error: upErr } = await this.adminClient.from('entity_factor_values').upsert(
        {
          entity_id: entityId,
          factor_id: idComp,
          model_version: 'v1',
          period_key: 'na',
          period_months: null,
          value_num: composite,
          value_text: null,
          source: 'taxonomy_structural_growth_cagr_composite',
          ingested_at: now,
          updated_at: now,
        },
        { onConflict: 'entity_id,factor_id,model_version,period_key' },
      );
      if (!upErr) entitiesUpdated += 1;
      else this.logger.warn(`CAGR composite upsert ${entityId}: ${upErr.message}`);
    }

    return { entitiesUpdated };
  }

  /**
   * Backfill/sync taxonomy CAGR numeric scores (3y/5y/10y + composite)
   * from existing structural-growth LLM payloads already stored in entity_factor_values.
   */
  async syncCagrScoresFromStoredPayloads(options?: {
    limit?: number;
  }): Promise<TaxonomyStructuralGrowthCagrSyncResult> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }

    const resolved = await this.resolveCagrFactorIds();
    if (!resolved) {
      throw new Error(
        'CAGR score factors not found. Apply migration 20260409120000_structural_growth_cagr_score_factors_formula.',
      );
    }
    const { id3, id5, id10, idComp } = resolved;
    const weights = await this.fetchCagrWeights();

    const levelFactorKeys = Object.values(FACTOR_KEY_BY_LEVEL);
    const { data: levelFactors, error: lfErr } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', levelFactorKeys);
    if (lfErr || !levelFactors?.length) {
      throw new Error(
        'Structural growth factors not found. Apply migration 20260408120000_taxonomy_structural_growth_ske71.',
      );
    }
    const levelFactorIdByKey = Object.fromEntries(
      levelFactors.map((f: { id: string; key: string }) => [f.key, f.id]),
    );

    const rawLimit = options?.limit;
    const limit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), 100000)
        : undefined;

    let entQuery = this.adminClient
      .from('entities')
      .select('id, entity_type')
      .in('entity_type', ['sector', 'industry', 'sub_industry'])
      .not('taxonomy_node_id', 'is', null);
    if (limit) entQuery = entQuery.limit(limit);
    const { data: entities, error: entErr } = await entQuery;
    if (entErr) {
      throw new Error(`Failed to load entities: ${entErr.message}`);
    }
    const rows = (entities ?? []) as { id: string; entity_type: string }[];
    const entityIds = rows.map((r) => r.id);
    if (!entityIds.length) {
      return {
        entitiesScanned: 0,
        horizonScoresUpserted: 0,
        compositesUpserted: 0,
        entitiesWithAllHorizons: 0,
        entitiesMissingAnyHorizon: 0,
        errors: [],
      };
    }

    const result: TaxonomyStructuralGrowthCagrSyncResult = {
      entitiesScanned: rows.length,
      horizonScoresUpserted: 0,
      compositesUpserted: 0,
      entitiesWithAllHorizons: 0,
      entitiesMissingAnyHorizon: 0,
      errors: [],
    };

    const now = new Date().toISOString();
    const horizonByPeriodKey = new Map(HORIZON_META.map((h) => [h.periodKey, h.periodMonths]));

    for (const row of rows) {
      const levelFactorKey = FACTOR_KEY_BY_LEVEL[row.entity_type];
      const levelFactorId = levelFactorIdByKey[levelFactorKey];
      if (!levelFactorId) {
        result.errors.push(`Entity ${row.id}: missing level factor "${levelFactorKey}"`);
        result.entitiesMissingAnyHorizon += 1;
        continue;
      }

      const { data: existing, error: exErr } = await this.adminClient
        .from('entity_factor_values')
        .select('period_key, period_months, value_text')
        .eq('entity_id', row.id)
        .eq('factor_id', levelFactorId)
        .eq('model_version', 'v1')
        .in('period_key', ['3y', '5y', '10y']);
      if (exErr) {
        result.errors.push(`Entity ${row.id}: load existing payloads failed (${exErr.message})`);
        result.entitiesMissingAnyHorizon += 1;
        continue;
      }

      const scoreByHorizon: Partial<Record<'3y' | '5y' | '10y', number>> = {};
      for (const ev of existing ?? []) {
        const r = ev as { period_key: string; period_months: number | null; value_text: unknown };
        const horizon = r.period_key as '3y' | '5y' | '10y';
        if (horizon !== '3y' && horizon !== '5y' && horizon !== '10y') continue;
        const parsed = parseValueTextJson(r.value_text);
        const score = cagrBucketToScore(parsed?.cagr_bucket);
        scoreByHorizon[horizon] = score;
        const scoreFactorId =
          horizon === '3y' ? id3 : horizon === '5y' ? id5 : id10;
        const periodMonths = r.period_months ?? horizonByPeriodKey.get(horizon) ?? null;
        const { error: upErr } = await this.adminClient.from('entity_factor_values').upsert(
          {
            entity_id: row.id,
            factor_id: scoreFactorId,
            model_version: 'v1',
            period_key: 'na',
            period_months: periodMonths,
            value_num: score,
            value_text: String(score),
            source: 'taxonomy_structural_growth_cagr_sync',
            ingested_at: now,
            updated_at: now,
          },
          { onConflict: 'entity_id,factor_id,model_version,period_key' },
        );
        if (upErr) {
          result.errors.push(
            `Entity ${row.id} (${horizon} score upsert): ${upErr.message}`,
          );
        } else {
          result.horizonScoresUpserted += 1;
        }
      }

      const s3 = scoreByHorizon['3y'];
      const s5 = scoreByHorizon['5y'];
      const s10 = scoreByHorizon['10y'];
      if (s3 === undefined || s5 === undefined || s10 === undefined) {
        result.entitiesMissingAnyHorizon += 1;
        continue;
      }
      result.entitiesWithAllHorizons += 1;
      const composite = this.compositeValue(weights, s3, s5, s10);
      const { error: compErr } = await this.adminClient.from('entity_factor_values').upsert(
        {
          entity_id: row.id,
          factor_id: idComp,
          model_version: 'v1',
          period_key: 'na',
          period_months: null,
          value_num: composite,
          value_text: null,
          source: 'taxonomy_structural_growth_cagr_sync',
          ingested_at: now,
          updated_at: now,
        },
        { onConflict: 'entity_id,factor_id,model_version,period_key' },
      );
      if (compErr) {
        result.errors.push(`Entity ${row.id} (composite upsert): ${compErr.message}`);
      } else {
        result.compositesUpserted += 1;
      }
    }

    return result;
  }

  async run(options: {
    limit?: number;
    delayMs?: number;
  }): Promise<TaxonomyStructuralGrowthRunResult> {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }

    const rawDelay = options.delayMs;
    const delayMs =
      typeof rawDelay === 'number' && Number.isFinite(rawDelay)
        ? Math.min(Math.max(Math.floor(rawDelay), 0), 120_000)
        : 2500;
    const limit = options.limit;

    const { data: ents, error: entErr } = await this.adminClient
      .from('entities')
      .select('id, entity_type, taxonomy_node_id')
      .in('entity_type', ['sector', 'industry', 'sub_industry'])
      .not('taxonomy_node_id', 'is', null);

    if (entErr) {
      throw new Error(`Failed to load entities: ${entErr.message}`);
    }

    let rows = (ents ?? []) as { id: string; entity_type: string; taxonomy_node_id: string }[];
    if (typeof limit === 'number' && limit > 0) {
      rows = rows.slice(0, limit);
    }

    if (rows.length === 0) {
      this.logger.warn(
        'Structural growth: 0 taxonomy entities — Gemini generateContent will not be called',
      );
      return {
        entitiesProcessed: 0,
        llmCalls: 0,
        errors: [
          'No taxonomy entities to process. Need rows in `entities` with entity_type sector, industry, or sub_industry and a non-null taxonomy_node_id. Gemini was not called.',
        ],
      };
    }

    this.logger.log(
      `Structural growth: ${rows.length} entity/entities, delayMs=${delayMs}, up to ${rows.length * HORIZON_META.length} Gemini calls`,
    );

    const nodeIds = [...new Set(rows.map((r) => r.taxonomy_node_id))];
    const { data: nodes, error: nodeErr } = await this.adminClient
      .from('taxonomy_nodes')
      .select('node_id, title, code, description')
      .in('node_id', nodeIds);

    if (nodeErr) {
      throw new Error(`Failed to load taxonomy nodes: ${nodeErr.message}`);
    }

    const nodeById = new Map(
      (nodes ?? []).map((n: { node_id: string; title: string | null; code: string | null; description: string | null }) => [
        n.node_id,
        n,
      ]),
    );

    const factorKeysToLoad = [
      ...Object.values(FACTOR_KEY_BY_LEVEL),
      ...Object.values(SCORE_FACTOR_KEYS),
      COMPOSITE_FACTOR_KEY,
    ];
    const { data: factorRows, error: fErr } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', factorKeysToLoad);

    if (fErr || !factorRows?.length) {
      throw new Error('Structural growth factors not found. Apply migration 20260408120000_taxonomy_structural_growth_ske71.');
    }

    const factorIdByKey = Object.fromEntries(factorRows.map((f: { id: string; key: string }) => [f.key, f.id]));
    for (const k of factorKeysToLoad) {
      if (!factorIdByKey[k]) {
        throw new Error(
          `Factor "${k}" not found. Apply migrations 20260408120000_taxonomy_structural_growth_ske71 and 20260409120000_structural_growth_cagr_score_factors_formula.`,
        );
      }
    }

    const cagrWeights = await this.fetchCagrWeights();

    const totalLlmCallsPlanned = rows.length * HORIZON_META.length;

    const errors: string[] = [];
    let llmCalls = 0;
    let entitiesProcessed = 0;
    let llmCallIndex = 0;
    let stopRunEarly = false;

    for (let i = 0; i < rows.length; i++) {
      if (stopRunEarly) break;
      const row = rows[i];
      const factorKey = FACTOR_KEY_BY_LEVEL[row.entity_type];
      const factorId = factorKey ? factorIdByKey[factorKey] : undefined;
      if (!factorId) {
        errors.push(`No factor for entity_type ${row.entity_type}`);
        continue;
      }

      const node = nodeById.get(row.taxonomy_node_id);
      const name = (node?.title ?? '').trim() || 'Unknown';
      const code = (node?.code ?? '').trim();
      const description = (node?.description ?? '').slice(0, 800);

      const templateVars: Record<string, string> = {
        level: row.entity_type,
        name,
        code,
        description,
      };

      const horizonScores: Partial<Record<'3y' | '5y' | '10y', number>> = {};
      let entityOk = true;
      for (const { periodKey, periodMonths } of HORIZON_META) {
        if (llmCallIndex > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }

        const promptKey = PROMPT_KEY_BY_HORIZON[periodKey];
        try {
          const pv = await this.loadActivePromptVersion(promptKey);
          if (!pv) {
            errors.push(`${name} (${periodKey}): no active prompt for ${promptKey}`);
            entityOk = false;
            break;
          }

          this.logger.log(
            `Structural growth: LLM ${llmCallIndex + 1}/${totalLlmCallsPlanned} start — entity ${i + 1}/${rows.length} "${name}" (${row.entity_type}) ${periodKey}`,
          );

          const result = await this.runGemini(apiKey, pv, templateVars);
          llmCalls += 1;
          llmCallIndex += 1;
          const normalized = this.normalizePayload(result, periodKey);
          const bucketScore = cagrBucketToScore(normalized.cagr_bucket);
          horizonScores[periodKey] = bucketScore;
          const enriched = { ...normalized, cagr_bucket_score: bucketScore };
          const valueText = JSON.stringify(enriched);
          const cycleSignal = normalized.cycle_signal;
          const valueNum =
            typeof cycleSignal === 'number' && !Number.isNaN(cycleSignal)
              ? Math.max(-1, Math.min(1, cycleSignal))
              : null;

          const { error: upErr } = await this.adminClient.from('entity_factor_values').upsert(
            {
              entity_id: row.id,
              factor_id: factorId,
              model_version: 'v1',
              period_key: periodKey,
              period_months: periodMonths,
              value_num: valueNum,
              value_text: valueText,
              source: 'llm_taxonomy_structural_growth',
              ingested_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'entity_id,factor_id,model_version,period_key' },
          );

          if (upErr) {
            errors.push(`${name} (${periodKey}): ${upErr.message}`);
            entityOk = false;
            break;
          }

          const scoreFactorKey = SCORE_FACTOR_KEYS[periodKey];
          const scoreFactorId = factorIdByKey[scoreFactorKey];
          const { error: scoreErr } = await this.adminClient.from('entity_factor_values').upsert(
            {
              entity_id: row.id,
              factor_id: scoreFactorId,
              model_version: 'v1',
              period_key: 'na',
              period_months: periodMonths,
              value_num: bucketScore,
              value_text: String(bucketScore),
              source: 'llm_taxonomy_structural_growth',
              ingested_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'entity_id,factor_id,model_version,period_key' },
          );

          if (scoreErr) {
            errors.push(`${name} (${periodKey} bucket score): ${scoreErr.message}`);
            entityOk = false;
            break;
          }

          this.logger.log(
            `Structural growth: LLM ${llmCalls}/${totalLlmCallsPlanned} done — entity ${i + 1}/${rows.length} "${name}" (${row.entity_type}) ${periodKey} (persisted)`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${name} (${periodKey}): ${msg}`);
          this.logger.warn(
            `Structural growth: LLM ${llmCallIndex + 1}/${totalLlmCallsPlanned} failed — entity ${i + 1}/${rows.length} "${name}" (${row.entity_type}) ${periodKey}: ${msg}`,
          );
          const lower = msg.toLowerCase();
          if (
            lower.includes('user location is not supported for the api use') ||
            lower.includes('location is not supported')
          ) {
            errors.push(
              'Gemini request blocked by region policy. Structural growth run stopped early. Use taxonomy CAGR sync from stored payloads or run from a supported region.',
            );
            stopRunEarly = true;
          }
          entityOk = false;
          break;
        }
      }

      if (entityOk) {
        const s3 = horizonScores['3y'];
        const s5 = horizonScores['5y'];
        const s10 = horizonScores['10y'];
        if (s3 === undefined || s5 === undefined || s10 === undefined) {
          errors.push(`${name} (composite): missing horizon scores`);
        } else {
          const composite = this.compositeValue(cagrWeights, s3, s5, s10);
          const { error: compErr } = await this.adminClient.from('entity_factor_values').upsert(
            {
              entity_id: row.id,
              factor_id: factorIdByKey[COMPOSITE_FACTOR_KEY],
              model_version: 'v1',
              period_key: 'na',
              period_months: null,
              value_num: composite,
              value_text: null,
              source: 'taxonomy_structural_growth_cagr_composite',
              ingested_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'entity_id,factor_id,model_version,period_key' },
          );
          if (compErr) {
            errors.push(`${name} (composite): ${compErr.message}`);
          } else {
            entitiesProcessed += 1;
            this.logger.log(
              `Structural growth: entity ${i + 1}/${rows.length} complete — "${name}" (${row.entity_type}), composite saved (${entitiesProcessed} with full 3y/5y/10y so far)`,
            );
          }
        }
      }
    }

    this.logger.log(
      `Structural growth: run finished — llmCalls=${llmCalls}/${totalLlmCallsPlanned}, entitiesProcessed=${entitiesProcessed}, errorCount=${errors.length}`,
    );

    return { entitiesProcessed, llmCalls, errors };
  }
}
