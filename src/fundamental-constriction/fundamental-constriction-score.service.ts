import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const MODEL_VERSION = 'v1';
const PERIOD_KEY = 'na';

function fcWeightsFromDefinition(def: unknown): {
  fc_earnings_acceleration_pct: number;
  fc_margin_expansion_pct: number;
  fc_roic_improvement_pct: number;
  fc_valuation_compression_pct: number;
  fc_balance_sheet_strength_pct: number;
} {
  const w = (def as { weights?: Record<string, number> } | null)?.weights;
  const defaults = {
    fc_earnings_acceleration_pct: 0.3,
    fc_margin_expansion_pct: 0.25,
    fc_roic_improvement_pct: 0.2,
    fc_valuation_compression_pct: 0.15,
    fc_balance_sheet_strength_pct: 0.1,
  };
  if (!w) return defaults;
  return {
    fc_earnings_acceleration_pct:
      typeof w.fc_earnings_acceleration_pct === 'number' && Number.isFinite(w.fc_earnings_acceleration_pct)
        ? w.fc_earnings_acceleration_pct
        : defaults.fc_earnings_acceleration_pct,
    fc_margin_expansion_pct:
      typeof w.fc_margin_expansion_pct === 'number' && Number.isFinite(w.fc_margin_expansion_pct)
        ? w.fc_margin_expansion_pct
        : defaults.fc_margin_expansion_pct,
    fc_roic_improvement_pct:
      typeof w.fc_roic_improvement_pct === 'number' && Number.isFinite(w.fc_roic_improvement_pct)
        ? w.fc_roic_improvement_pct
        : defaults.fc_roic_improvement_pct,
    fc_valuation_compression_pct:
      typeof w.fc_valuation_compression_pct === 'number' && Number.isFinite(w.fc_valuation_compression_pct)
        ? w.fc_valuation_compression_pct
        : defaults.fc_valuation_compression_pct,
    fc_balance_sheet_strength_pct:
      typeof w.fc_balance_sheet_strength_pct === 'number' && Number.isFinite(w.fc_balance_sheet_strength_pct)
        ? w.fc_balance_sheet_strength_pct
        : defaults.fc_balance_sheet_strength_pct,
  };
}

const FC_FACTOR_KEYS = [
  'fc_earnings_acceleration_pct',
  'fc_margin_expansion_pct',
  'fc_roic_improvement_pct',
  'fc_valuation_compression_pct',
  'fc_balance_sheet_strength_pct',
] as const;

export interface FundamentalConstrictionScoreRow {
  ticker: string;
  security_id: string;
  score: number;
  rank: number;
  percentiles?: Record<string, number>;
  raw?: Record<string, number>;
}

export interface FundamentalConstrictionCalculateResult {
  tickersRequested: number;
  tickersWithData: number;
  scoresWritten: number;
  errors: { ticker: string; message: string }[];
  /** First 10 by rank (prefix of `rankings`). */
  top10: FundamentalConstrictionScoreRow[];
  /** Every scored security from the run (active, `entity_id` not null), ordered by rank. */
  rankings: FundamentalConstrictionScoreRow[];
}

/** Nullable signals straight from FMP parsing (before imputation). */
type FetchedFcRaw = {
  epsAcceleration: number | null;
  marginExpansion: number | null;
  roicImprovement: number | null;
  peCompression: number | null;
  debtImprovement: number | null;
};

type RawRow = {
  ticker: string;
  entityId: string;
  securityId: string;
  epsAcceleration: number;
  marginExpansion: number;
  roicImprovement: number;
  peCompression: number;
  debtImprovement: number;
  /** Human-readable labels for signals that were null from FMP and stored as 0. */
  fcImputed?: string[];
};

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function fmpParseArray(data: unknown): Record<string, unknown>[] | null {
  if (data == null) return null;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null && 'Error Message' in data) {
    return null;
  }
  return null;
}

function rowEpsGrowthPct(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  return num(
    row.growthEPSDiluted ??
      row.growthEPS ??
      row.growthEps ??
      row.epsGrowth ??
      row.epsgrowth ??
      row['growthEPS'],
  );
}

/** Operating margin % — prefer reported ratio; else operatingIncome / revenue. */
function incomeOperatingMarginPct(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  const direct = num(
    row.operatingIncomeRatio ??
      row.operatingProfitMargin ??
      row.operatingMargin ??
      row.ebitdaMargin,
  );
  if (direct != null) return direct;
  const oi = num(row.operatingIncome);
  const rev = num(row.revenue);
  if (oi != null && rev != null && Math.abs(rev) > 1e-12) return (oi / rev) * 100;
  return null;
}

function incomeGrossMarginPct(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  const direct = num(row.grossProfitRatio ?? row.grossProfitMargin);
  if (direct != null) return direct;
  const gp = num(row.grossProfit);
  const rev = num(row.revenue);
  if (gp != null && rev != null && Math.abs(rev) > 1e-12) return (gp / rev) * 100;
  return null;
}

function ratioRoicPct(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  return num(
    row.returnOnInvestedCapital ??
      row.returnOnCapitalEmployed ??
      row.roic ??
      row.roce,
  );
}

function ratioDebtEquity(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  return num(
    row.debtEquityRatio ?? row.debtToEquityRatio ?? row.totalDebtToEquity ?? row.debtRatio,
  );
}

function kmPe(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  return num(row.peRatioTTM ?? row.peRatio ?? row.priceToEarningsRatio);
}

function ske35MissingParts(raw: FetchedFcRaw): string[] {
  const parts: string[] = [];
  if (raw.epsAcceleration == null) parts.push('EPS acceleration');
  if (raw.marginExpansion == null) parts.push('margin change');
  if (raw.roicImprovement == null) parts.push('ROIC change');
  if (raw.peCompression == null) parts.push('P/E change');
  if (raw.debtImprovement == null) parts.push('debt/equity change');
  return parts;
}

function percentile01(sortedAsc: number[], x: number): number | null {
  if (sortedAsc.length === 0) return null;
  const n = sortedAsc.length;
  if (n === 1) return 0.5;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  const eq0 = lo;
  hi = n;
  lo = eq0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  const eq1 = lo;
  const midRank = (eq0 + (eq1 - 1)) / 2;
  return midRank / (n - 1);
}

function toPctileScores(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v != null && !Number.isNaN(v));
  if (present.length === 0) return values.map(() => null);
  const sorted = [...present].sort((a, b) => a - b);
  return values.map((v) => {
    if (v == null || Number.isNaN(v)) return null;
    const p = percentile01(sorted, v);
    return p == null ? null : p * 100;
  });
}

@Injectable()
export class FundamentalConstrictionScoreService {
  private readonly logger = new Logger(FundamentalConstrictionScoreService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private getApiKey(): string | undefined {
    return (
      this.config.get<string>('fmp.apiKey') ??
      this.config.get<string>('FMP_API_KEY') ??
      process.env.FMP_API_KEY
    );
  }

  private getBaseUrl(): string {
    return (
      this.config.get<string>('fmp.baseUrl') ??
      process.env.FMP_API_BASE_URL ??
      'https://financialmodelingprep.com'
    ).replace(/\/$/, '');
  }

  /** Raw JSON; detects FMP "Error Message" payloads returned with HTTP 2xx. */
  private async fmpGetRaw(path: string): Promise<unknown> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('FMP_API_KEY not configured');
      return null;
    }
    const sep = path.includes('?') ? '&' : '?';
    const url = `${this.getBaseUrl()}${path}${sep}apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      this.logger.warn(
        `FMP ${path} -> ${res.status} ${typeof data === 'string' ? data : JSON.stringify(data)?.slice(0, 240)}`,
      );
      return null;
    }
    if (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      'Error Message' in data
    ) {
      this.logger.warn(
        `FMP ${path}: ${String((data as { ['Error Message']?: string })['Error Message'])}`,
      );
      return null;
    }
    return data;
  }

  /** Try stable query URL first; if empty or missing, try legacy /api/v3/... path. */
  private async fmpGetArrayStableThenV3(
    stablePath: string,
    v3Path: string,
  ): Promise<Record<string, unknown>[] | null> {
    const a = fmpParseArray(await this.fmpGetRaw(stablePath));
    if (a && a.length > 0) return a;
    const b = fmpParseArray(await this.fmpGetRaw(v3Path));
    if (b && b.length > 0) return b;
    return a ?? b ?? null;
  }

  private async loadTargets(options: {
    tickers?: string[];
    limit?: number;
  }): Promise<{
    rows: { ticker: string; entityId: string; securityId: string }[];
    error?: string;
  }> {
    if (!this.adminClient) return { rows: [] };

    const maxRows =
      options.limit != null && options.limit > 0
        ? options.limit
        : Number.MAX_SAFE_INTEGER;
    const pageSize = 1000;
    const rows: { ticker: string; entityId: string; securityId: string }[] = [];

    for (let from = 0; rows.length < maxRows; from += pageSize) {
      const remaining = maxRows - rows.length;
      const take = Math.min(pageSize, remaining);

      let q = this.adminClient
        .from('securities')
        .select('id, ticker, entity_id')
        .not('entity_id', 'is', null)
        .eq('active', true)
        .order('ticker', { ascending: true });

      if (options.tickers?.length) {
        q = q.in(
          'ticker',
          options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean),
        );
      }

      const to = from + take - 1;
      const { data, error } = await q.range(from, to);
      if (error) {
        this.logger.error(`loadTargets: ${error.message}`);
        return { rows: [], error: `Failed to load securities: ${error.message}` };
      }

      const batch = (data ?? [])
        .filter(
          (r: { ticker?: string; entity_id?: string | null }) =>
            r.ticker && r.entity_id,
        )
        .map((r: { id: string; ticker: string; entity_id: string }) => ({
          ticker: r.ticker.trim().toUpperCase(),
          entityId: r.entity_id,
          securityId: r.id,
        }));

      rows.push(...batch);

      if (batch.length < take) break;
    }

    return { rows };
  }

  /** Explains why loadTargets returned no rows (entity link required). */
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
      const sym = String(r.ticker ?? '')
        .trim()
        .toUpperCase();
      if (r.active === false) {
        return `${sym}: inactive (active=false)`;
      }
      if (r.entity_id == null) {
        return `${sym}: missing entity_id — link the security to an entity before scoring`;
      }
      return `${sym}: still excluded (unexpected; check DB constraints)`;
    });
    errors.push({
      ticker: '_',
      message: `${preamble} ${reasons.join('; ')}.`,
    });
  }

  private async fetchRawForTicker(ticker: string): Promise<FetchedFcRaw> {
    const t = ticker.trim();
    const sym = encodeURIComponent(t);
    const seg = encodeURIComponent(t);

    const [growth, income, ratiosTtm, ratiosAnn, kmTtm, kmAnn] = await Promise.all([
      this.fmpGetArrayStableThenV3(
        `/stable/income-statement-growth?symbol=${sym}&period=annual&limit=4`,
        `/api/v3/income-statement-growth/${seg}?period=annual&limit=4`,
      ),
      this.fmpGetArrayStableThenV3(
        `/stable/income-statement?symbol=${sym}&period=annual&limit=3`,
        `/api/v3/income-statement/${seg}?period=annual&limit=3`,
      ),
      this.fmpGetArrayStableThenV3(
        `/stable/ratios-ttm?symbol=${sym}`,
        `/api/v3/ratios-ttm/${seg}`,
      ),
      this.fmpGetArrayStableThenV3(
        `/stable/ratios?symbol=${sym}&period=annual&limit=3`,
        `/api/v3/ratios/${seg}?period=annual&limit=3`,
      ),
      this.fmpGetArrayStableThenV3(
        `/stable/key-metrics-ttm?symbol=${sym}`,
        `/api/v3/key-metrics-ttm/${seg}`,
      ),
      this.fmpGetArrayStableThenV3(
        `/stable/key-metrics?symbol=${sym}&period=annual&limit=3`,
        `/api/v3/key-metrics/${seg}?period=annual&limit=3`,
      ),
    ]);

    let epsAcceleration: number | null = null;
    if (growth && growth.length >= 2) {
      const g0 = rowEpsGrowthPct(growth[0]);
      const g1 = rowEpsGrowthPct(growth[1]);
      if (g0 != null && g1 != null) {
        epsAcceleration = g0 - g1;
      } else {
        const n0 = num(growth[0]!.growthNetIncome);
        const n1 = num(growth[1]!.growthNetIncome);
        if (n0 != null && n1 != null) epsAcceleration = n0 - n1;
      }
    }

    let marginExpansion: number | null = null;
    if (income && income.length >= 2) {
      const m0 = incomeOperatingMarginPct(income[0]);
      const m1 = incomeOperatingMarginPct(income[1]);
      if (m0 != null && m1 != null) {
        marginExpansion = m0 - m1;
      } else {
        const gp0 = incomeGrossMarginPct(income[0]);
        const gp1 = incomeGrossMarginPct(income[1]);
        if (gp0 != null && gp1 != null) marginExpansion = gp0 - gp1;
      }
    }

    let roicImprovement: number | null = null;
    if (ratiosAnn && ratiosAnn.length >= 2) {
      const r0 = ratioRoicPct(ratiosAnn[0]);
      const r1 = ratioRoicPct(ratiosAnn[1]);
      if (r0 != null && r1 != null) roicImprovement = r0 - r1;
    }
    if (roicImprovement == null && ratiosTtm?.[0] && ratiosAnn?.[0]) {
      const ttm = num(
        ratiosTtm[0]!.returnOnInvestedCapitalTTM ??
          ratiosTtm[0]!.returnOnCapitalEmployedTTM,
      );
      const y0 = ratioRoicPct(ratiosAnn[0]);
      if (ttm != null && y0 != null) roicImprovement = ttm - y0;
    }
    if (roicImprovement == null && kmAnn && kmAnn.length >= 2) {
      const k0 = ratioRoicPct(kmAnn[0]);
      const k1 = ratioRoicPct(kmAnn[1]);
      if (k0 != null && k1 != null) roicImprovement = k0 - k1;
    }

    let peCompression: number | null = null;
    const peTtm = kmTtm?.[0] ? kmPe(kmTtm[0]) : null;
    const peY0 = kmAnn?.[0] ? kmPe(kmAnn[0]) : null;
    const peY1 = kmAnn?.[1] ? kmPe(kmAnn[1]) : null;
    if (peTtm != null && peY0 != null) {
      peCompression = peY0 - peTtm;
    } else if (peY0 != null && peY1 != null) {
      peCompression = peY1 - peY0;
    } else if (ratiosAnn && ratiosAnn.length >= 2) {
      const p0 = num(
        ratiosAnn[0]!.priceToEarningsRatio ??
          ratiosAnn[0]!.priceEarningsRatio ??
          ratiosAnn[0]!.peRatio,
      );
      const p1 = num(
        ratiosAnn[1]!.priceToEarningsRatio ??
          ratiosAnn[1]!.priceEarningsRatio ??
          ratiosAnn[1]!.peRatio,
      );
      if (p0 != null && p1 != null) peCompression = p1 - p0;
    }

    let debtImprovement: number | null = null;
    const deTtm = ratiosTtm?.[0]
      ? (num(ratiosTtm[0]!.debtEquityRatioTTM) ?? ratioDebtEquity(ratiosTtm[0]))
      : null;
    const de0 = ratiosAnn?.[0] ? ratioDebtEquity(ratiosAnn[0]) : null;
    const de1 = ratiosAnn?.[1] ? ratioDebtEquity(ratiosAnn[1]) : null;
    if (de1 != null && de0 != null) {
      debtImprovement = de1 - de0;
    } else if (de1 != null && deTtm != null) {
      debtImprovement = de1 - deTtm;
    }

    return {
      epsAcceleration,
      marginExpansion,
      roicImprovement,
      peCompression,
      debtImprovement,
    };
  }

  async calculateScores(options: {
    tickers?: string[];
    limit?: number;
  }): Promise<FundamentalConstrictionCalculateResult> {
    const empty: FundamentalConstrictionCalculateResult = {
      tickersRequested: 0,
      tickersWithData: 0,
      scoresWritten: 0,
      errors: [],
      top10: [],
      rankings: [],
    };
    if (!this.adminClient) {
      empty.errors.push({ ticker: '_', message: 'Supabase not configured' });
      return empty;
    }
    if (!this.getApiKey()) {
      empty.errors.push({ ticker: '_', message: 'FMP_API_KEY not configured' });
      return empty;
    }

    const { rows: targets, error: loadTargetsErr } = await this.loadTargets(options);
    if (loadTargetsErr) {
      empty.errors.push({ ticker: '_', message: loadTargetsErr });
      return empty;
    }
    empty.tickersRequested = targets.length;
    if (targets.length === 0) {
      await this.appendNoTargetsDiagnostics(empty.errors, options);
      return empty;
    }

    const { data: formulaRow } = await this.adminClient
      .from('formulas')
      .select('id, definition')
      .eq('key', 'fundamental_constriction_score')
      .maybeSingle();
    if (!formulaRow?.id) {
      empty.errors.push({
        ticker: '_',
        message:
          'Formula fundamental_constriction_score not found; run Supabase migration 20260401120000_seed_fundamental_constriction_ske35.sql',
      });
      return empty;
    }
    const fcWeights = fcWeightsFromDefinition(formulaRow.definition);

    const { data: factorRows } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', [...FC_FACTOR_KEYS]);
    const factorIdByKey = Object.fromEntries(
      (factorRows ?? []).map((f: { id: string; key: string }) => [f.key, f.id]),
    );
    for (const k of FC_FACTOR_KEYS) {
      if (!factorIdByKey[k]) {
        empty.errors.push({
          ticker: '_',
          message: `Factor ${k} not found in database`,
        });
        return empty;
      }
    }

    const rawRows: RawRow[] = [];
    const errors: { ticker: string; message: string }[] = [];

    for (const t of targets) {
      try {
        const fetched = await this.fetchRawForTicker(t.ticker);
        const imputed = ske35MissingParts(fetched);
        if (imputed.length > 0) {
          this.logger.debug(
            `FC ${t.ticker}: missing FMP fields [${imputed.join('; ')}] — using 0 for score`,
          );
        }
        const row: RawRow = {
          ticker: t.ticker,
          entityId: t.entityId,
          securityId: t.securityId,
          epsAcceleration: fetched.epsAcceleration ?? 0,
          marginExpansion: fetched.marginExpansion ?? 0,
          roicImprovement: fetched.roicImprovement ?? 0,
          peCompression: fetched.peCompression ?? 0,
          debtImprovement: fetched.debtImprovement ?? 0,
          ...(imputed.length > 0 ? { fcImputed: imputed } : {}),
        };
        rawRows.push(row);
      } catch (e) {
        errors.push({
          ticker: t.ticker,
          message: e instanceof Error ? e.message : String(e),
        });
      }
      await new Promise((r) => setTimeout(r, 120));
    }

    empty.errors = errors;
    empty.tickersWithData = rawRows.length;
    if (rawRows.length === 0) return empty;

    const pEps = toPctileScores(rawRows.map((r) => r.epsAcceleration));
    const pMar = toPctileScores(rawRows.map((r) => r.marginExpansion));
    const pRoic = toPctileScores(rawRows.map((r) => r.roicImprovement));
    const pPe = toPctileScores(rawRows.map((r) => r.peCompression));
    const pDebt = toPctileScores(rawRows.map((r) => r.debtImprovement));

    const now = new Date().toISOString();
    const efvRows: Record<string, unknown>[] = [];
    const scoreRows: {
      entity_id: string;
      formula_id: string;
      score: number;
      rank: number | null;
      explanation: Record<string, unknown>;
      updated_at: string;
    }[] = [];

    const finals: { ticker: string; entityId: string; securityId: string; score: number }[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i]!;
      const sEps = pEps[i];
      const sMar = pMar[i];
      const sRoic = pRoic[i];
      const sPe = pPe[i];
      const sDebt = pDebt[i];
      if (
        sEps == null ||
        sMar == null ||
        sRoic == null ||
        sPe == null ||
        sDebt == null
      ) {
        continue;
      }
      const final =
        fcWeights.fc_earnings_acceleration_pct * sEps +
        fcWeights.fc_margin_expansion_pct * sMar +
        fcWeights.fc_roic_improvement_pct * sRoic +
        fcWeights.fc_valuation_compression_pct * sPe +
        fcWeights.fc_balance_sheet_strength_pct * sDebt;

      finals.push({
        ticker: r.ticker,
        entityId: r.entityId,
        securityId: r.securityId,
        score: final,
      });

      const pairs: [(typeof FC_FACTOR_KEYS)[number], number][] = [
        ['fc_earnings_acceleration_pct', sEps],
        ['fc_margin_expansion_pct', sMar],
        ['fc_roic_improvement_pct', sRoic],
        ['fc_valuation_compression_pct', sPe],
        ['fc_balance_sheet_strength_pct', sDebt],
      ];
      for (const [key, val] of pairs) {
        efvRows.push({
          entity_id: r.entityId,
          factor_id: factorIdByKey[key],
          model_version: MODEL_VERSION,
          period_key: PERIOD_KEY,
          value_num: val,
          source: 'fmp_ske35',
          ingested_at: now,
        });
      }

      scoreRows.push({
        entity_id: r.entityId,
        formula_id: formulaRow.id,
        score: final,
        rank: null,
        explanation: {
          raw: {
            epsAcceleration: r.epsAcceleration,
            marginExpansion: r.marginExpansion,
            roicImprovement: r.roicImprovement,
            peCompression: r.peCompression,
            debtImprovement: r.debtImprovement,
          },
          ...(r.fcImputed?.length ? { fcImputedZeros: r.fcImputed } : {}),
          percentiles: {
            fc_earnings_acceleration_pct: sEps,
            fc_margin_expansion_pct: sMar,
            fc_roic_improvement_pct: sRoic,
            fc_valuation_compression_pct: sPe,
            fc_balance_sheet_strength_pct: sDebt,
          },
          weights: fcWeights,
        },
        updated_at: now,
      });
    }

    const BATCH = 75;
    for (let i = 0; i < efvRows.length; i += BATCH) {
      const chunk = efvRows.slice(i, i + BATCH);
      const { error: efvErr } = await this.adminClient
        .from('entity_factor_values')
        .upsert(chunk, { onConflict: 'entity_id,factor_id,model_version,period_key' });
      if (efvErr) {
        this.logger.error(`entity_factor_values upsert: ${efvErr.message}`);
        throw new Error(efvErr.message);
      }
    }

    finals.sort((a, b) => b.score - a.score);
    const rankByEntity = new Map<string, number>();
    finals.forEach((f, idx) => rankByEntity.set(f.entityId, idx + 1));

    for (const row of scoreRows) {
      row.rank = rankByEntity.get(row.entity_id) ?? null;
    }

    for (let i = 0; i < scoreRows.length; i += BATCH) {
      const chunk = scoreRows.slice(i, i + BATCH);
      const { error: scErr } = await this.adminClient
        .from('entity_scores_current')
        .upsert(
          chunk.map((c) => ({
            entity_id: c.entity_id,
            formula_id: c.formula_id,
            score: c.score,
            rank: c.rank,
            explanation: c.explanation,
            updated_at: c.updated_at,
          })),
          { onConflict: 'entity_id,formula_id' },
        );
      if (scErr) {
        this.logger.error(`entity_scores_current upsert: ${scErr.message}`);
        throw new Error(scErr.message);
      }
    }

    const hist = scoreRows.map((row) => ({
      entity_id: row.entity_id,
      formula_id: row.formula_id,
      score: row.score,
    }));
    
    for (let i = 0; i < hist.length; i += BATCH) {
      await this.adminClient.from('entity_scores_history').insert(hist.slice(i, i + BATCH));
    }

    empty.scoresWritten = scoreRows.length;
    const rankings = finals.map((f, idx) => ({
      ticker: f.ticker,
      security_id: f.securityId,
      score: Math.round(f.score * 1000) / 1000,
      rank: idx + 1,
    }));
    empty.rankings = rankings;
    empty.top10 = rankings.slice(0, 10);

    return empty;
  }

  /** Return persisted scores without triggering a recalculation. */
  async loadCurrentScores(options: {
    tickers?: string[];
    limit?: number;
  }): Promise<FundamentalConstrictionCalculateResult> {
    const empty: FundamentalConstrictionCalculateResult = {
      tickersRequested: 0,
      tickersWithData: 0,
      scoresWritten: 0,
      errors: [],
      top10: [],
      rankings: [],
    };
    if (!this.adminClient) {
      empty.errors.push({ ticker: '_', message: 'Supabase not configured' });
      return empty;
    }

    const { data: formulaRow } = await this.adminClient
      .from('formulas')
      .select('id')
      .eq('key', 'fundamental_constriction_score')
      .maybeSingle();
    if (!formulaRow?.id) {
      empty.errors.push({ ticker: '_', message: 'Formula fundamental_constriction_score not found' });
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
      .in('entity_id', entityIds)
      .order('score', { ascending: false });

    const { data: csData, error: csErr } = await csQ;
    if (csErr) {
      empty.errors.push({ ticker: '_', message: `Failed to load current scores: ${csErr.message}` });
      return empty;
    }

    const rankings = ((csData ?? []) as {
      entity_id: string;
      score: number;
      rank: number | null;
      explanation: Record<string, unknown> | null;
    }[])
      .filter((r) => secByEntity.has(r.entity_id))
      .map((r, i) => {
        const ex = r.explanation ?? {};
        const percentiles = ex.percentiles as Record<string, number> | undefined;
        const raw = ex.raw as Record<string, number> | undefined;
        const sec = secByEntity.get(r.entity_id);
        return {
          ticker: sec?.ticker ?? '',
          security_id: sec?.securityId ?? '',
          score: r.score,
          rank: r.rank ?? i + 1,
          ...(percentiles ? { percentiles } : {}),
          ...(raw ? { raw } : {}),
        };
      });

    empty.tickersWithData = rankings.length;
    empty.rankings = rankings;
    empty.top10 = rankings.slice(0, 10);
    return empty;
  }
}

