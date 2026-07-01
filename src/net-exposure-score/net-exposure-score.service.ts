import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const MODEL_VERSION = 'v1';
const PERIOD_KEY = 'na';
const FORMULA_KEY = 'net_exposure_score';
const FACTOR_KEYS = ['ex_tailwind_score', 'ex_headwind_score', 'ex_net_exposure_score'] as const;

const DEFAULT_DIRECTION_WEIGHT: Record<string, number> = {
  beneficiary: 1.0,
  supplier: 0.7,
  customer: 0.5,
  dependent: 0.5,
};

const SECURITY_ID_CHUNK = 150;

type ExposureAssignmentRow = {
  security_id: string;
  exposure_id: string;
  direction: string;
  strength: number | null;
  confidence: number | null;
  as_of_date: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type TargetRow = {
  ticker: string;
  entityId: string;
  securityId: string;
};

type SecurityScore = {
  ticker: string;
  entityId: string;
  securityId: string;
  score: number;
  tailwind: number;
  headwind: number;
  rowsUsed: number;
  noPolarityRows: number;
};

type DirectionWeights = {
  beneficiary: number;
  supplier: number;
  customer: number;
  dependent: number;
};

export interface NetExposureScoreRow {
  ticker: string;
  security_id: string;
  score: number;
  rank: number | null;
  tailwind: number;
  headwind: number;
  rowsUsed: number;
  noPolarityRows: number;
}

export interface NetExposureScoreCalculateResult {
  tickersRequested: number;
  tickersWithData: number;
  scoresWritten: number;
  errors: { ticker: string; message: string }[];
  scores: NetExposureScoreRow[];
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function parsePolarity(v: unknown): -1 | 0 | 1 {
  const n = typeof v === 'number' ? v : Number(v);
  if (n === -1) return -1;
  if (n === 1) return 1;
  return 0;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

@Injectable()
export class NetExposureScoreService {
  private readonly logger = new Logger(NetExposureScoreService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private async loadTargets(options: {
    tickers?: string[];
    limit?: number;
  }): Promise<{ rows: TargetRow[]; error?: string }> {
    if (!this.adminClient) return { rows: [] };
    let q = this.adminClient
      .from('securities')
      .select('id, ticker, entity_id')
      .not('entity_id', 'is', null)
      .eq('active', true);
    if (options.tickers?.length) {
      q = q.in(
        'ticker',
        options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean),
      );
    }
    if (options.limit != null && options.limit > 0) {
      q = q.limit(options.limit);
    }
    const { data, error } = await q;
    if (error) {
      this.logger.error(`loadTargets: ${error.message}`);
      return { rows: [], error: `Failed to load securities: ${error.message}` };
    }
    const rows = (data ?? [])
      .filter((r: { ticker?: string; entity_id?: string | null; id?: string }) => r.ticker && r.entity_id && r.id)
      .map((r: { ticker: string; entity_id: string; id: string }) => ({
        ticker: r.ticker.trim().toUpperCase(),
        entityId: r.entity_id,
        securityId: r.id,
      }));
    return { rows };
  }

  private async appendNoTargetsDiagnostics(
    errors: { ticker: string; message: string }[],
    options: { tickers?: string[]; limit?: number },
  ): Promise<void> {
    if (!this.adminClient) return;
    const preamble =
      'No securities matched the scoring query (requires active=true and a non-null entity_id).';
    const tickers = options.tickers?.length
      ? options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean)
      : [];
    if (!tickers.length) {
      errors.push({
        ticker: '_',
        message: `${preamble} There are no such rows in the database yet — ingest securities and assign entity_id, or widen filters.`,
      });
      return;
    }
    const { data, error } = await this.adminClient
      .from('securities')
      .select('ticker, entity_id, active')
      .in('ticker', tickers);
    if (error) {
      errors.push({
        ticker: '_',
        message: `${preamble} Could not look up tickers: ${error.message}.`,
      });
      return;
    }
    const list = (data ?? []) as {
      ticker: string;
      entity_id: string | null;
      active: boolean | null;
    }[];
    if (list.length === 0) {
      errors.push({
        ticker: '_',
        message: `${preamble} None of these tickers exist in securities: ${tickers.join(', ')}.`,
      });
      return;
    }
    const reasons = list.map((r) => {
      const sym = String(r.ticker ?? '').trim().toUpperCase();
      if (r.active === false) return `${sym}: inactive (active=false)`;
      if (r.entity_id == null) return `${sym}: missing entity_id`;
      return `${sym}: unexpected exclusion`;
    });
    errors.push({ ticker: '_', message: `${preamble} ${reasons.join('; ')}.` });
  }

  private async loadLatestExposureAssignments(
    securityIds: string[],
  ): Promise<Map<string, ExposureAssignmentRow[]>> {
    const bySecurity = new Map<string, ExposureAssignmentRow[]>();
    if (!this.adminClient || securityIds.length === 0) return bySecurity;

    for (const part of chunkArray(securityIds, SECURITY_ID_CHUNK)) {
      const { data, error } = await this.adminClient
        .from('security_exposures')
        .select('security_id, exposure_id, direction, strength, confidence, as_of_date, updated_at, created_at')
        .in('security_id', part)
        .order('as_of_date', { ascending: false })
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) {
        throw new Error(`Failed loading security exposures: ${error.message}`);
      }
      const latestByKey = new Map<string, ExposureAssignmentRow>();
      for (const row of (data ?? []) as ExposureAssignmentRow[]) {
        const k = `${row.security_id}|${row.exposure_id}|${row.direction}`;
        if (!latestByKey.has(k)) latestByKey.set(k, row);
      }
      for (const row of latestByKey.values()) {
        const list = bySecurity.get(row.security_id) ?? [];
        list.push(row);
        bySecurity.set(row.security_id, list);
      }
    }
    return bySecurity;
  }

  async calculateScores(options: {
    tickers?: string[];
    limit?: number;
    minScore?: number;
    maxScore?: number;
    directionWeights?: Partial<DirectionWeights>;
  }): Promise<NetExposureScoreCalculateResult> {
    const empty: NetExposureScoreCalculateResult = {
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

    const { rows: targets, error: targetErr } = await this.loadTargets(options);
    if (targetErr) {
      empty.errors.push({ ticker: '_', message: targetErr });
      return empty;
    }
    empty.tickersRequested = targets.length;
    if (targets.length === 0) {
      await this.appendNoTargetsDiagnostics(empty.errors, options);
      return empty;
    }

    const { data: formulaRow } = await this.adminClient
      .from('formulas')
      .select('id')
      .eq('key', FORMULA_KEY)
      .maybeSingle();
    if (!formulaRow?.id) {
      empty.errors.push({
        ticker: '_',
        message:
          'Formula net_exposure_score not found; run migration 20260415110000_seed_net_exposure_score_ske41.sql',
      });
      return empty;
    }

    const { data: factorRows } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', [...FACTOR_KEYS]);
    const factorIdByKey = Object.fromEntries(
      (factorRows ?? []).map((f: { id: string; key: string }) => [f.key, f.id]),
    );
    for (const k of FACTOR_KEYS) {
      if (!factorIdByKey[k]) {
        empty.errors.push({
          ticker: '_',
          message: `Factor ${k} not found; run migration 20260415110000_seed_net_exposure_score_ske41.sql`,
        });
        return empty;
      }
    }

    const securityIds = targets.map((t) => t.securityId);
    const assignmentBySecurity = await this.loadLatestExposureAssignments(securityIds);
    const exposureIds = [
      ...new Set(
        [...assignmentBySecurity.values()].flatMap((rows) => rows.map((r) => r.exposure_id)),
      ),
    ];
    const polarityByExposure = new Map<string, -1 | 0 | 1>();
    if (exposureIds.length > 0) {
      const { data: exposureRows, error: expErr } = await this.adminClient
        .from('exposures')
        .select('exposure_id, polarity')
        .in('exposure_id', exposureIds);
      if (expErr) {
        throw new Error(`Failed loading exposures polarity: ${expErr.message}`);
      }
      for (const row of (exposureRows ?? []) as { exposure_id: string; polarity: number | null }[]) {
        polarityByExposure.set(row.exposure_id, parsePolarity(row.polarity));
      }
    }

    const scoreRows: SecurityScore[] = [];
    const directionWeights: DirectionWeights = {
      beneficiary:
        options.directionWeights?.beneficiary ?? DEFAULT_DIRECTION_WEIGHT.beneficiary,
      supplier: options.directionWeights?.supplier ?? DEFAULT_DIRECTION_WEIGHT.supplier,
      customer: options.directionWeights?.customer ?? DEFAULT_DIRECTION_WEIGHT.customer,
      dependent: options.directionWeights?.dependent ?? DEFAULT_DIRECTION_WEIGHT.dependent,
    };

    for (const t of targets) {
      const rows = assignmentBySecurity.get(t.securityId) ?? [];
      let tailwind = 0;
      let headwind = 0;
      let net = 0;
      let noPolarityRows = 0;
      for (const row of rows) {
        const directionKey = row.direction as keyof DirectionWeights;
        const directionWeight = directionWeights[directionKey] ?? directionWeights.beneficiary;
        const term = directionWeight * clamp01(row.strength) * clamp01(row.confidence);
        const polarity = polarityByExposure.has(row.exposure_id)
          ? polarityByExposure.get(row.exposure_id)!
          : 0;
        if (!polarityByExposure.has(row.exposure_id)) noPolarityRows++;
        if (polarity === 1) tailwind += term;
        if (polarity === -1) headwind += term;
        net += polarity * term;
      }
      scoreRows.push({
        ticker: t.ticker,
        entityId: t.entityId,
        securityId: t.securityId,
        score: net,
        tailwind,
        headwind,
        rowsUsed: rows.length,
        noPolarityRows,
      });
    }

    empty.tickersWithData = scoreRows.length;

    const ranked = [...scoreRows].sort((a, b) => b.score - a.score);
    const globalRankByEntity = new Map<string, number>();
    ranked.forEach((r, idx) => globalRankByEntity.set(r.entityId, idx + 1));

    let filtered = scoreRows;
    if (options.minScore != null && Number.isFinite(options.minScore)) {
      filtered = filtered.filter((r) => r.score >= options.minScore!);
    }
    if (options.maxScore != null && Number.isFinite(options.maxScore)) {
      filtered = filtered.filter((r) => r.score <= options.maxScore!);
    }
    const filteredRanked = [...filtered].sort((a, b) => b.score - a.score);
    const responseRankByEntity = new Map<string, number>();
    filteredRanked.forEach((r, idx) => responseRankByEntity.set(r.entityId, idx + 1));

    const now = new Date().toISOString();
    const efvRows: Record<string, unknown>[] = [];
    const currentScoreRows: Record<string, unknown>[] = [];
    const historyRows: Record<string, unknown>[] = [];

    for (const r of scoreRows) {
      efvRows.push(
        {
          entity_id: r.entityId,
          factor_id: factorIdByKey.ex_tailwind_score,
          model_version: MODEL_VERSION,
          period_key: PERIOD_KEY,
          value_num: r.tailwind,
          source: 'net_exposure_score_engine',
          ingested_at: now,
        },
        {
          entity_id: r.entityId,
          factor_id: factorIdByKey.ex_headwind_score,
          model_version: MODEL_VERSION,
          period_key: PERIOD_KEY,
          value_num: r.headwind,
          source: 'net_exposure_score_engine',
          ingested_at: now,
        },
        {
          entity_id: r.entityId,
          factor_id: factorIdByKey.ex_net_exposure_score,
          model_version: MODEL_VERSION,
          period_key: PERIOD_KEY,
          value_num: r.score,
          source: 'net_exposure_score_engine',
          ingested_at: now,
        },
      );

      currentScoreRows.push({
        entity_id: r.entityId,
        formula_id: formulaRow.id,
        score: r.score,
        rank: globalRankByEntity.get(r.entityId) ?? null,
        explanation: {
          asOf: now,
          rowsUsed: r.rowsUsed,
          noPolarityRows: r.noPolarityRows,
          tailwind: r.tailwind,
          headwind: r.headwind,
          netExposureScore: r.score,
          directionWeights,
          responseRank: responseRankByEntity.get(r.entityId) ?? null,
        } as Record<string, unknown>,
        updated_at: now,
      });

      historyRows.push({
        entity_id: r.entityId,
        formula_id: formulaRow.id,
        score: r.score,
      });
    }

    const BATCH = 75;
    for (let i = 0; i < efvRows.length; i += BATCH) {
      const chunk = efvRows.slice(i, i + BATCH);
      const { error: efvErr } = await this.adminClient
        .from('entity_factor_values')
        .upsert(chunk, { onConflict: 'entity_id,factor_id,model_version,period_key' });
      if (efvErr) {
        throw new Error(`entity_factor_values upsert failed: ${efvErr.message}`);
      }
    }

    for (let i = 0; i < currentScoreRows.length; i += BATCH) {
      const chunk = currentScoreRows.slice(i, i + BATCH);
      const { error: curErr } = await this.adminClient
        .from('entity_scores_current')
        .upsert(chunk, { onConflict: 'entity_id,formula_id' });
      if (curErr) {
        throw new Error(`entity_scores_current upsert failed: ${curErr.message}`);
      }
    }

    for (let i = 0; i < historyRows.length; i += BATCH) {
      const chunk = historyRows.slice(i, i + BATCH);
      const { error: histErr } = await this.adminClient
        .from('entity_scores_history')
        .insert(chunk);
      if (histErr) {
        throw new Error(`entity_scores_history insert failed: ${histErr.message}`);
      }
    }

    empty.scoresWritten = currentScoreRows.length;
    empty.scores = filtered.map((r) => ({
      ticker: r.ticker,
      security_id: r.securityId,
      score: Math.round(r.score * 100000) / 100000,
      rank: responseRankByEntity.get(r.entityId) ?? null,
      tailwind: Math.round(r.tailwind * 100000) / 100000,
      headwind: Math.round(r.headwind * 100000) / 100000,
      rowsUsed: r.rowsUsed,
      noPolarityRows: r.noPolarityRows,
    }));
    return empty;
  }

  /** Return persisted scores without triggering a recalculation. */
  async loadCurrentScores(options: {
    tickers?: string[];
    limit?: number;
    minScore?: number;
    maxScore?: number;
  }): Promise<NetExposureScoreCalculateResult> {
    const empty: NetExposureScoreCalculateResult = {
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

    const { data: formulaRow } = await this.adminClient
      .from('formulas')
      .select('id')
      .eq('key', FORMULA_KEY)
      .maybeSingle();
    if (!formulaRow?.id) {
      empty.errors.push({ ticker: '_', message: `Formula ${FORMULA_KEY} not found` });
      return empty;
    }

    let secQ = this.adminClient
      .from('securities')
      .select('id, ticker, entity_id')
      .not('entity_id', 'is', null)
      .eq('active', true);
    if (options.tickers?.length) {
      secQ = secQ.in('ticker', options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
    }
    if (options.limit != null && options.limit > 0) secQ = secQ.limit(options.limit);
    const { data: secData } = await secQ;
    const secByEntity = new Map<string, { ticker: string; securityId: string }>(
      ((secData ?? []) as { id: string; ticker: string; entity_id: string }[]).map((r) => [
        r.entity_id,
        { ticker: r.ticker, securityId: r.id },
      ]),
    );
    const entityIds = [...secByEntity.keys()];
    empty.tickersRequested = entityIds.length;
    if (entityIds.length === 0) return empty;

    let csQ = this.adminClient
      .from('entity_scores_current')
      .select('entity_id, score, rank, explanation')
      .eq('formula_id', formulaRow.id as string)
      .in('entity_id', entityIds);
    if (options.minScore != null && Number.isFinite(options.minScore)) {
      csQ = csQ.gte('score', options.minScore);
    }
    if (options.maxScore != null && Number.isFinite(options.maxScore)) {
      csQ = csQ.lte('score', options.maxScore);
    }
    csQ = csQ.order('score', { ascending: false });

    const { data: csData, error: csErr } = await csQ;
    if (csErr) {
      empty.errors.push({ ticker: '_', message: `Failed to load current scores: ${csErr.message}` });
      return empty;
    }

    const rows = ((csData ?? []) as {
      entity_id: string;
      score: number;
      rank: number | null;
      explanation: Record<string, unknown> | null;
    }[])
      .filter((r) => secByEntity.has(r.entity_id))
      .map((r, i) => {
        const ex = r.explanation ?? {};
        const sec = secByEntity.get(r.entity_id);
        return {
          ticker: sec?.ticker ?? '',
          security_id: sec?.securityId ?? '',
          score: r.score,
          rank: r.rank ?? i + 1,
          tailwind: typeof ex.tailwind === 'number' ? ex.tailwind : 0,
          headwind: typeof ex.headwind === 'number' ? ex.headwind : 0,
          rowsUsed: typeof ex.rowsUsed === 'number' ? ex.rowsUsed : 0,
          noPolarityRows: typeof ex.noPolarityRows === 'number' ? ex.noPolarityRows : 0,
        };
      });

    empty.tickersWithData = rows.length;
    empty.scores = rows;
    return empty;
  }
}
