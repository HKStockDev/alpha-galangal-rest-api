import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const PROMPT_KEY_BY_LEVEL: Record<string, string> = {
  sector: 'sector_cycle_score',
  industry: 'industry_cycle_score',
  sub_industry: 'sub_industry_cycle_score',
};

const HORIZONS: { periodKey: string; periodMonths: number; jsonKey: string }[] = [
  { periodKey: '1m', periodMonths: 1, jsonKey: '1m' },
  { periodKey: '3m', periodMonths: 3, jsonKey: '3m' },
  { periodKey: '6m', periodMonths: 6, jsonKey: '6m' },
  { periodKey: '12m', periodMonths: 12, jsonKey: '12m' },
  { periodKey: '24m', periodMonths: 24, jsonKey: '24m' },
];

type PromptVersionRow = {
  system_prompt: string | null;
  user_prompt_template: string | null;
  model_name: string | null;
  temperature: number | null;
  max_output_tokens: number | null;
};

export interface TaxonomyCycleScoreEntityRow {
  entityId: string;
  level: string;
  name: string;
  code: string;
  description: string;
}

export interface TaxonomyCycleScoreRunResult {
  entitiesTotal: number;
  entitiesProcessed: number;
  skippedNoPrompt: number;
  llmCalls: number;
  horizonUpserts: number;
  errors: string[];
}

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

function clampCycleScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  if (r <= -1) return -1;
  if (r >= 1) return 1;
  return 0;
}

@Injectable()
export class TaxonomyCycleScoreService {
  private readonly logger = new Logger(TaxonomyCycleScoreService.name);
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

  private defaultDelayMs(): number {
    const fromConfig = this.config.get<number>('dataSync.taxonomyCycleScoresDelayMs');
    if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig >= 0) {
      return fromConfig;
    }
    return 1500;
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
    const modelRaw = promptVersion.model_name || 'gemini-2.5-flash';
    const model = modelRaw.startsWith('models/') ? modelRaw : `models/${modelRaw}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: promptVersion.temperature ?? 0.2,
        maxOutputTokens: promptVersion.max_output_tokens ?? 256,
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

  private async fetchDistinctClassificationLeafNodeIds(): Promise<string[]> {
    if (!this.adminClient) return [];
    const out = new Set<string>();
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await this.adminClient
        .from('security_classifications')
        .select('taxonomy_node_id')
        .not('taxonomy_node_id', 'is', null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`security_classifications: ${error.message}`);
      if (!data?.length) break;
      for (const row of data as { taxonomy_node_id: string }[]) {
        if (row.taxonomy_node_id) out.add(row.taxonomy_node_id);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return [...out];
  }

  private collectAncestorNodeIds(
    leafIds: string[],
    nodeById: Map<string, { node_id: string; parent_node_id: string | null }>,
  ): Set<string> {
    const collected = new Set<string>();
    for (const leaf of leafIds) {
      let cur: string | null = leaf;
      const seen = new Set<string>();
      while (cur && nodeById.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        collected.add(cur);
        cur = nodeById.get(cur)!.parent_node_id;
      }
    }
    return collected;
  }

  /**
   * Sector / industry / sub-industry entities reachable from current security_classifications,
   * same scope as `scripts/seed-cycle-scores-for-securities.js`.
   */
  async listEntitiesForCycleSync(): Promise<TaxonomyCycleScoreEntityRow[]> {
    if (!this.adminClient) return [];
    const leafIds = await this.fetchDistinctClassificationLeafNodeIds();
    if (leafIds.length === 0) return [];

    const { data: allNodes, error: nErr } = await this.adminClient
      .from('taxonomy_nodes')
      .select('node_id, parent_node_id');
    if (nErr || !allNodes?.length) {
      this.logger.warn(`taxonomy_nodes load failed: ${nErr?.message ?? 'empty'}`);
      return [];
    }
    const nodeById = new Map(
      (allNodes as { node_id: string; parent_node_id: string | null }[]).map((n) => [
        n.node_id,
        n,
      ]),
    );
    const nodeIdSet = this.collectAncestorNodeIds(leafIds, nodeById);
    const nodeIds = [...nodeIdSet];
    if (nodeIds.length === 0) return [];

    const entities: TaxonomyCycleScoreEntityRow[] = [];
    const chunkSize = 150;
    for (let i = 0; i < nodeIds.length; i += chunkSize) {
      const chunk = nodeIds.slice(i, i + chunkSize);
      const { data: entRows, error: eErr } = await this.adminClient
        .from('entities')
        .select('id, entity_type, taxonomy_node_id')
        .in('entity_type', ['sector', 'industry', 'sub_industry'])
        .in('taxonomy_node_id', chunk);
      if (eErr) throw new Error(`entities: ${eErr.message}`);
      const rows = (entRows ?? []) as {
        id: string;
        entity_type: string;
        taxonomy_node_id: string;
      }[];
      if (!rows.length) continue;

      const { data: metaRows, error: mErr } = await this.adminClient
        .from('taxonomy_nodes')
        .select('node_id, title, code, description')
        .in(
          'node_id',
          rows.map((r) => r.taxonomy_node_id),
        );
      if (mErr) throw new Error(`taxonomy_nodes meta: ${mErr.message}`);
      const metaByNode = new Map(
        (metaRows ?? []).map((m: { node_id: string; title: string | null; code: string | null; description: string | null }) => [
          m.node_id,
          m,
        ]),
      );

      for (const r of rows) {
        const m = metaByNode.get(r.taxonomy_node_id);
        const title = m?.title ?? '';
        const code = m?.code ?? '';
        const desc = typeof m?.description === 'string' ? m.description : '';
        entities.push({
          entityId: r.id,
          level: r.entity_type,
          name: title || code || r.id,
          code,
          description: desc,
        });
      }
    }

    entities.sort((a, b) => {
      const lt = a.level.localeCompare(b.level);
      if (lt !== 0) return lt;
      return (a.name || '').localeCompare(b.name || '');
    });
    return entities;
  }

  /**
   * LLM cycle scores (-1 / 0 / 1) per 1m, 3m, 6m, 12m, 24m for each taxonomy entity in scope; upserts `entity_factor_values`.
   */
  async run(options?: {
    limit?: number | null;
    delayMs?: number | null;
  }): Promise<TaxonomyCycleScoreRunResult> {
    const result: TaxonomyCycleScoreRunResult = {
      entitiesTotal: 0,
      entitiesProcessed: 0,
      skippedNoPrompt: 0,
      llmCalls: 0,
      horizonUpserts: 0,
      errors: [],
    };

    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      result.errors.push('GEMINI_API_KEY is not configured');
      return result;
    }
    if (!this.adminClient) {
      result.errors.push('Supabase client not configured');
      return result;
    }

    const factorKeys = ['sector_cycle_score', 'industry_cycle_score', 'sub_industry_cycle_score'];
    const { data: factorRows, error: fErr } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', factorKeys);
    if (fErr || !factorRows?.length) {
      result.errors.push(
        fErr?.message ?? 'Cycle score factors not found (sector_cycle_score / industry_cycle_score / sub_industry_cycle_score).',
      );
      return result;
    }
    const factorIdByKey = Object.fromEntries(
      factorRows.map((f: { id: string; key: string }) => [f.key, f.id]),
    );
    for (const k of factorKeys) {
      if (!factorIdByKey[k]) {
        result.errors.push(`Missing factor row for key "${k}"`);
        return result;
      }
    }

    let rows = await this.listEntitiesForCycleSync();
    result.entitiesTotal = rows.length;

    const rawLimit = options?.limit;
    if (typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0) {
      rows = rows.slice(0, Math.floor(rawLimit));
    }

    const delayMs =
      options?.delayMs != null && Number.isFinite(options.delayMs) && options.delayMs! >= 0
        ? Math.floor(options.delayMs!)
        : this.defaultDelayMs();

    const now = new Date().toISOString();
    const maxErrors = 80;

    for (let i = 0; i < rows.length; i++) {
      if (i > 0 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      const row = rows[i];
      const promptKey = PROMPT_KEY_BY_LEVEL[row.level];
      if (!promptKey) continue;
      const factorId = factorIdByKey[promptKey];
      const name = row.name || row.code || row.entityId;

      try {
        const promptVersion = await this.loadActivePromptVersion(promptKey);
        if (!promptVersion) {
          result.skippedNoPrompt += 1;
          this.logger.warn(`No active prompt for ${promptKey}; skipping ${row.level} "${name}"`);
          continue;
        }

        const llmOut = await this.runGemini(apiKey, promptVersion, {
          level: row.level,
          name,
          code: row.code ?? '',
          description: (row.description || '').slice(0, 500),
        });
        result.llmCalls += 1;

        const valueByKey = Object.fromEntries(
          HORIZONS.map((h) => [h.jsonKey, clampCycleScore(llmOut[h.jsonKey])]),
        ) as Record<string, number>;
        const valueText = JSON.stringify(valueByKey);

        let entityHorizonsOk = 0;
        for (const h of HORIZONS) {
          const value = valueByKey[h.jsonKey] ?? 0;
          const { error: upErr } = await this.adminClient.from('entity_factor_values').upsert(
            {
              entity_id: row.entityId,
              factor_id: factorId,
              model_version: 'v1',
              period_key: h.periodKey,
              period_months: h.periodMonths,
              value_num: value,
              value_text: valueText,
              source: 'llm_taxonomy_cycle',
              ingested_at: now,
              updated_at: now,
            },
            { onConflict: 'entity_id,factor_id,model_version,period_key' },
          );
          if (upErr) {
            if (result.errors.length < maxErrors) {
              result.errors.push(`${row.level} "${name}" (${h.periodKey}): ${upErr.message}`);
            }
          } else {
            result.horizonUpserts += 1;
            entityHorizonsOk += 1;
          }
        }
        if (entityHorizonsOk === HORIZONS.length) {
          result.entitiesProcessed += 1;
        }
        const horizonSummary = HORIZONS.map((h) => `${h.jsonKey}=${valueByKey[h.jsonKey] ?? 0}`).join(
          ' ',
        );
        this.logger.log(
          `Taxonomy cycle [${i + 1}/${rows.length}] ${row.level} "${name}" → ${horizonSummary}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (result.errors.length < maxErrors) {
          result.errors.push(`${row.level} "${name}": ${msg}`);
        }
        this.logger.warn(`Taxonomy cycle failed for ${row.level} "${name}": ${msg}`);
      }
    }

    return result;
  }
}
