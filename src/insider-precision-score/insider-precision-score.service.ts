import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_INSIDER_PRECISION_FORMULA_PARAMS,
  mergeInsiderPrecisionParams,
  type InsiderPrecisionFormulaParams,
} from '../formulas/formulas.service';

const MODEL_VERSION = 'v1';
const PERIOD_KEY = 'snapshot';
const FORMULA_KEY = 'insider_precision_score';

const SEC_CODE_TO_NORMALIZED: Record<string, string> = {
  P: 'buy',
  S: 'sell',
  M: 'option_exercise',
  A: 'other',
  G: 'gift',
  F: 'other',
  I: 'other',
  C: 'other',
  W: 'other',
  D: 'other',
  X: 'option_exercise',
  Z: 'other',
};

/** DB role enum → which param key carries its weight. */
const ROLE_TO_PARAM_KEY: Record<
  string,
  keyof Omit<
    InsiderPrecisionFormulaParams,
    | 'recency_weight_0_30_days'
    | 'recency_weight_31_60_days'
    | 'recency_weight_61_90_days'
    | 'signal_lookback_days'
    | 'buy_cluster_multiplier_1'
    | 'buy_cluster_multiplier_2'
    | 'buy_cluster_multiplier_3_plus'
    | 'sell_cluster_multiplier_1'
    | 'sell_cluster_multiplier_2'
    | 'sell_cluster_multiplier_3_plus'
    | 'score_scaling_factor'
    | 'minimum_trade_value_threshold_usd'
    | 'included_transaction_types'
    | 'market_cap_normalization_method'
  >
> = {
  CEO: 'role_weight_ceo',
  CFO: 'role_weight_cfo',
  CHAIRMAN: 'role_weight_chairman',
  DIRECTOR: 'role_weight_director',
  TEN_PERCENT_OWNER: 'role_weight_ten_percent_owner',
  FOUNDER: 'role_weight_officer',
  OTHER_EXECUTIVE: 'role_weight_officer',
  PRESIDENT: 'role_weight_president',
};

export interface InsiderPrecisionCalculateResult {
  tickersRequested: number;
  tickersWithData: number;
  scoresWritten: number;
  tradesUsed: number;
  errors: { ticker: string; message: string }[];
  scores: {
    ticker: string;
    score: number;
    rank: number | null;
    buyPressure: number;
    sellPressure: number;
    netPressure: number;
    tradesUsed: number;
    uniqueBuyers: number;
    uniqueSellers: number;
  }[];
}

type TargetRow = {
  ticker: string;
  entityId: string;
  securityId: string;
  marketCapUsd: number | null;
  enterpriseValueUsd: number | null;
  revenueTtmUsd: number | null;
};

type InsiderTradeRow = {
  insiderId: string;
  role: string;
  personEntityId: string;
  transactionType: string;
  transactionTypeRaw: string | null;
  valueUsd: number | null;
  shares: number | null;
  priceUsd: number | null;
  tradeDate: string;
};

function daysBetween(earlier: string, later: Date): number {
  const d = new Date(`${earlier}T12:00:00.000Z`);
  return Math.floor((later.getTime() - d.getTime()) / 86_400_000);
}

function recencyWeight(p: InsiderPrecisionFormulaParams, daysAgo: number): number {
  if (daysAgo <= 30) return p.recency_weight_0_30_days;
  if (daysAgo <= 60) return p.recency_weight_31_60_days;
  if (daysAgo <= 90) return p.recency_weight_61_90_days;
  return 0;
}

function roleWeight(p: InsiderPrecisionFormulaParams, role: string): number {
  const key = ROLE_TO_PARAM_KEY[role.toUpperCase()];
  if (!key) return p.role_weight_officer;
  return (p as unknown as Record<string, number>)[key] ?? p.role_weight_officer;
}

function clusterMultiplier(n: number, m1: number, m2: number, m3: number): number {
  if (n >= 3) return m3;
  if (n === 2) return m2;
  return m1;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

@Injectable()
export class InsiderPrecisionScoreService {
  private readonly logger = new Logger(InsiderPrecisionScoreService.name);
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
      .select('id, ticker, entity_id, market_cap')
      .not('entity_id', 'is', null)
      .eq('active', true);
    if (options.tickers?.length) {
      q = q.in(
        'ticker',
        options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean),
      );
    }
    if (options.limit != null && options.limit > 0) q = q.limit(options.limit);
    const { data, error } = await q;
    if (error) {
      this.logger.error(`loadTargets: ${error.message}`);
      return { rows: [], error: `Failed to load securities: ${error.message}` };
    }
    const rows = (data ?? [])
      .filter(
        (r: Record<string, unknown>) => r.ticker && r.entity_id && r.id,
      )
      .map((r: Record<string, unknown>) => ({
        ticker: String(r.ticker).trim().toUpperCase(),
        entityId: String(r.entity_id),
        securityId: String(r.id),
        marketCapUsd: typeof r.market_cap === 'number' ? r.market_cap : r.market_cap != null ? Number(r.market_cap) : null,
        enterpriseValueUsd: null,
        revenueTtmUsd: null,
      }));
    return { rows };
  }

  private async loadTradesForEntities(
    entityIds: string[],
    lookbackDays: number,
  ): Promise<Map<string, InsiderTradeRow[]>> {
    const byEntityId = new Map<string, InsiderTradeRow[]>();
    if (!this.adminClient || entityIds.length === 0) return byEntityId;

    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - lookbackDays);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    for (const chunk of chunkArray(entityIds, 100)) {
      const { data: insiderRows, error: insiderErr } = await this.adminClient
        .from('insiders')
        .select('id, company_entity_id, person_entity_id, role')
        .in('company_entity_id', chunk);

      if (insiderErr) {
        this.logger.error(`loadInsiders chunk: ${insiderErr.message}`);
        continue;
      }
      if (!insiderRows?.length) continue;

      const insiderIds = (insiderRows as { id: string }[]).map((r) => r.id);
      const insiderMeta = new Map<
        string,
        { company_entity_id: string; person_entity_id: string; role: string }
      >(
        (
          insiderRows as {
            id: string;
            company_entity_id: string;
            person_entity_id: string;
            role: string;
          }[]
        ).map((r) => [r.id, r]),
      );

      for (const tradeChunk of chunkArray(insiderIds, 200)) {
        const { data: tradeRows, error: tradeErr } = await this.adminClient
          .from('insider_trades')
          .select(
            'insider_id, transaction_type, transaction_type_raw, value_usd, shares, price_usd, trade_date',
          )
          .in('insider_id', tradeChunk)
          .gte('trade_date', cutoffStr)
          .order('trade_date', { ascending: false });

        if (tradeErr) {
          this.logger.error(`loadTrades chunk: ${tradeErr.message}`);
          continue;
        }
        for (const t of (tradeRows ?? []) as Record<string, unknown>[]) {
          const meta = insiderMeta.get(String(t.insider_id));
          if (!meta) continue;
          const companyEntityId = meta.company_entity_id;
          const list = byEntityId.get(companyEntityId) ?? [];
          list.push({
            insiderId: String(t.insider_id),
            role: meta.role,
            personEntityId: meta.person_entity_id,
            transactionType: String(t.transaction_type ?? ''),
            transactionTypeRaw: t.transaction_type_raw != null ? String(t.transaction_type_raw) : null,
            valueUsd:
              typeof t.value_usd === 'number'
                ? t.value_usd
                : t.value_usd != null
                  ? Number(t.value_usd)
                  : null,
            shares:
              typeof t.shares === 'number'
                ? t.shares
                : t.shares != null
                  ? Number(t.shares)
                  : null,
            priceUsd:
              typeof t.price_usd === 'number'
                ? t.price_usd
                : t.price_usd != null
                  ? Number(t.price_usd)
                  : null,
            tradeDate: String(t.trade_date),
          });
          byEntityId.set(companyEntityId, list);
        }
      }
    }
    return byEntityId;
  }

  private tradePassesTypeFilter(
    trade: InsiderTradeRow,
    allowedSecCodes: Set<string>,
    allowedNormalizedTypes: Set<string>,
  ): boolean {
    if (trade.transactionTypeRaw) {
      const raw = trade.transactionTypeRaw.toUpperCase();
      // Match exact code (e.g. "P") or FMP-style "P-Purchase" / "S-Sale" prefix
      if (allowedSecCodes.has(raw)) return true;
      const letter = raw.charAt(0);
      return allowedSecCodes.has(letter);
    }
    return allowedNormalizedTypes.has(trade.transactionType);
  }

  private scoreForTarget(
    target: TargetRow,
    trades: InsiderTradeRow[],
    p: InsiderPrecisionFormulaParams,
    asOf: Date,
    allowedSecCodes: Set<string>,
    allowedNormalizedTypes: Set<string>,
  ): {
    score: number;
    buyPressure: number;
    sellPressure: number;
    netPressure: number;
    tradesUsed: number;
    uniqueBuyers: number;
    uniqueSellers: number;
  } {
    const uniqueBuyerIds = new Set<string>();
    const uniqueSellerIds = new Set<string>();
    let buyPressureSum = 0;
    let sellPressureSum = 0;
    let tradesUsed = 0;

    for (const trade of trades) {
      if (!this.tradePassesTypeFilter(trade, allowedSecCodes, allowedNormalizedTypes)) continue;

      const isBuy =
        trade.transactionType === 'buy' ||
        (trade.transactionTypeRaw != null &&
          SEC_CODE_TO_NORMALIZED[trade.transactionTypeRaw.toUpperCase()] === 'buy');
      const isSell =
        trade.transactionType === 'sell' ||
        (trade.transactionTypeRaw != null &&
          SEC_CODE_TO_NORMALIZED[trade.transactionTypeRaw.toUpperCase()] === 'sell');

      if (!isBuy && !isSell) continue;

      const valueUsd =
        trade.valueUsd ??
        (trade.shares != null && trade.priceUsd != null ? trade.shares * trade.priceUsd : null);
      if (valueUsd == null || valueUsd < p.minimum_trade_value_threshold_usd) continue;

      const daysAgo = daysBetween(trade.tradeDate, asOf);
      if (daysAgo < 0 || daysAgo > p.signal_lookback_days) continue;

      const rw = recencyWeight(p, daysAgo);
      if (rw === 0) continue;

      const rWeight = roleWeight(p, trade.role);
      const adjusted = valueUsd * rw * rWeight;

      if (isBuy) {
        buyPressureSum += adjusted;
        uniqueBuyerIds.add(trade.personEntityId);
      } else {
        sellPressureSum += adjusted;
        uniqueSellerIds.add(trade.personEntityId);
      }
      tradesUsed++;
    }

    const buyMult = clusterMultiplier(
      uniqueBuyerIds.size,
      p.buy_cluster_multiplier_1,
      p.buy_cluster_multiplier_2,
      p.buy_cluster_multiplier_3_plus,
    );
    const sellMult = clusterMultiplier(
      uniqueSellerIds.size,
      p.sell_cluster_multiplier_1,
      p.sell_cluster_multiplier_2,
      p.sell_cluster_multiplier_3_plus,
    );

    const buyPressure = buyPressureSum * buyMult;
    const sellPressure = sellPressureSum * sellMult;
    const netPressure = buyPressure - sellPressure;

    let normDenominator: number | null = null;
    switch (p.market_cap_normalization_method) {
      case 'enterprise_value':
        normDenominator = target.enterpriseValueUsd;
        break;
      case 'revenue_ttm':
        normDenominator = target.revenueTtmUsd;
        break;
      default:
        normDenominator = target.marketCapUsd;
    }

    const pressureRatio =
      normDenominator != null && normDenominator > 0 ? netPressure / normDenominator : 0;

    const rawScore = 100 * Math.tanh(pressureRatio * p.score_scaling_factor);
    const score = Math.round(rawScore * 100) / 100;

    return {
      score,
      buyPressure,
      sellPressure,
      netPressure,
      tradesUsed,
      uniqueBuyers: uniqueBuyerIds.size,
      uniqueSellers: uniqueSellerIds.size,
    };
  }

  async calculateScores(options: {
    tickers?: string[];
    limit?: number;
    minScore?: number;
    maxScore?: number;
  }): Promise<InsiderPrecisionCalculateResult> {
    const empty: InsiderPrecisionCalculateResult = {
      tickersRequested: 0,
      tickersWithData: 0,
      scoresWritten: 0,
      tradesUsed: 0,
      errors: [],
      scores: [],
    };

    if (!this.adminClient) {
      empty.errors.push({ ticker: '_', message: 'Supabase not configured' });
      return empty;
    }

    // Load formula params from DB
    const { data: formulaRow } = await this.adminClient
      .from('formulas')
      .select('id, definition')
      .eq('key', FORMULA_KEY)
      .maybeSingle();

    if (!formulaRow?.id) {
      empty.errors.push({
        ticker: '_',
        message: 'Formula insider_precision_score not found; run migration 20260415120000_seed_insider_precision_score_ske36.sql',
      });
      return empty;
    }

    const defRaw = formulaRow.definition as Record<string, unknown> | null;
    const paramsRaw =
      defRaw?.type === 'insider_precision' && defRaw?.params && typeof defRaw.params === 'object'
        ? (defRaw.params as Record<string, unknown>)
        : {};
    const p = mergeInsiderPrecisionParams(paramsRaw);

    // Build allowed filter sets
    const allowedSecCodes = new Set(
      p.included_transaction_types.map((c) => c.toUpperCase()),
    );
    const allowedNormalizedTypes = new Set(
      p.included_transaction_types
        .map((c) => SEC_CODE_TO_NORMALIZED[c.toUpperCase()])
        .filter((t): t is string => Boolean(t)),
    );

    // Load targets
    const { rows: targets, error: targetErr } = await this.loadTargets(options);
    if (targetErr) {
      empty.errors.push({ ticker: '_', message: targetErr });
      return empty;
    }
    empty.tickersRequested = targets.length;
    if (targets.length === 0) {
      empty.errors.push({
        ticker: '_',
        message: 'No active securities with entity_id found. Ingest securities and link entity_id.',
      });
      return empty;
    }

    // Load trades
    const entityIds = [...new Set(targets.map((t) => t.entityId))];
    const tradesByEntity = await this.loadTradesForEntities(entityIds, p.signal_lookback_days);

    // Score each security
    const asOf = new Date();
    type ScoredRow = InsiderPrecisionCalculateResult['scores'][number] & { entityId: string };
    const allScored: ScoredRow[] = [];

    for (const target of targets) {
      const trades = tradesByEntity.get(target.entityId) ?? [];
      if (trades.length === 0) continue;
      const result = this.scoreForTarget(
        target,
        trades,
        p,
        asOf,
        allowedSecCodes,
        allowedNormalizedTypes,
      );
      if (result.tradesUsed === 0) continue;
      allScored.push({ ...result, ticker: target.ticker, rank: null, entityId: target.entityId });
      empty.tradesUsed += result.tradesUsed;
    }

    empty.tickersWithData = allScored.length;

    // Global rank (by score descending)
    const globalRanked = [...allScored].sort((a, b) => b.score - a.score);
    const rankByEntity = new Map<string, number>();
    globalRanked.forEach((r, i) => rankByEntity.set(r.entityId, i + 1));

    for (const r of allScored) r.rank = rankByEntity.get(r.entityId) ?? null;

    // Apply score filter for response
    let filtered = allScored;
    if (options.minScore != null && Number.isFinite(options.minScore)) {
      filtered = filtered.filter((r) => r.score >= options.minScore!);
    }
    if (options.maxScore != null && Number.isFinite(options.maxScore)) {
      filtered = filtered.filter((r) => r.score <= options.maxScore!);
    }
    filtered.sort((a, b) => b.score - a.score);

    empty.scores = filtered.map(({ entityId: _e, ...rest }) => rest);

    // Persist to entity_scores_current and entity_scores_history
    const now = new Date().toISOString();
    const currentRows = allScored.map((r) => ({
      entity_id: r.entityId,
      formula_id: formulaRow.id as string,
      score: r.score,
      rank: r.rank,
      explanation: {
        asOf: now,
        buyPressure: r.buyPressure,
        sellPressure: r.sellPressure,
        netPressure: r.netPressure,
        tradesUsed: r.tradesUsed,
        uniqueBuyers: r.uniqueBuyers,
        uniqueSellers: r.uniqueSellers,
        params: {
          signal_lookback_days: p.signal_lookback_days,
          score_scaling_factor: p.score_scaling_factor,
          market_cap_normalization_method: p.market_cap_normalization_method,
        },
      } as Record<string, unknown>,
      updated_at: now,
    }));

    const historyRows = allScored.map((r) => ({
      entity_id: r.entityId,
      formula_id: formulaRow.id as string,
      score: r.score,
    }));

    const BATCH = 75;
    let written = 0;
    for (const chunk of chunkArray(currentRows, BATCH)) {
      const { error: upsertErr } = await this.adminClient
        .from('entity_scores_current')
        .upsert(chunk, { onConflict: 'entity_id,formula_id' });
      if (upsertErr) {
        empty.errors.push({
          ticker: '_',
          message: `entity_scores_current upsert failed: ${upsertErr.message}`,
        });
      } else {
        written += chunk.length;
      }
    }
    for (const chunk of chunkArray(historyRows, BATCH)) {
      const { error: histErr } = await this.adminClient.from('entity_scores_history').insert(chunk);
      if (histErr) {
        this.logger.warn(`entity_scores_history insert: ${histErr.message}`);
      }
    }

    empty.scoresWritten = written;
    return empty;
  }

  async loadCurrentScores(options: {
    tickers?: string[];
    limit?: number;
    minScore?: number;
    maxScore?: number;
  }): Promise<InsiderPrecisionCalculateResult> {
    const empty: InsiderPrecisionCalculateResult = {
      tickersRequested: 0,
      tickersWithData: 0,
      scoresWritten: 0,
      tradesUsed: 0,
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
      empty.errors.push({
        ticker: '_',
        message: 'Formula insider_precision_score not found',
      });
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
    const secByEntity = new Map<string, string>(
      ((secData ?? []) as { id: string; ticker: string; entity_id: string }[]).map((r) => [
        r.entity_id,
        r.ticker,
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
        return {
          ticker: secByEntity.get(r.entity_id) ?? '',
          score: r.score,
          rank: r.rank ?? i + 1,
          buyPressure: typeof ex.buyPressure === 'number' ? ex.buyPressure : 0,
          sellPressure: typeof ex.sellPressure === 'number' ? ex.sellPressure : 0,
          netPressure: typeof ex.netPressure === 'number' ? ex.netPressure : 0,
          tradesUsed: typeof ex.tradesUsed === 'number' ? ex.tradesUsed : 0,
          uniqueBuyers: typeof ex.uniqueBuyers === 'number' ? ex.uniqueBuyers : 0,
          uniqueSellers: typeof ex.uniqueSellers === 'number' ? ex.uniqueSellers : 0,
        };
      });

    empty.tickersWithData = rows.length;
    empty.scores = rows;
    return empty;
  }
}
