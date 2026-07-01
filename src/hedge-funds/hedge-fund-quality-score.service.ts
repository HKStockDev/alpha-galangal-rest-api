import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  allHedgeFundFactorKeysForLookup,
  MODEL_VERSION,
  resolveHedgeFundMetricValue,
  SCORE_METRIC_COLUMNS,
} from './hedge-fund-factor-mapping';

const HEDGE_FUND_IDENTITY_SELECT = 'filer_id, entity_id, filer, first_date_13f_filed';

const ENTITY_BATCH = 150;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function zscore(values: (number | null)[]) {
  const arr = values.filter((v): v is number => v != null && !Number.isNaN(v));
  if (arr.length === 0) return () => 0;
  const mean = arr.reduce((a: number, b: number) => a + b, 0) / arr.length;
  const variance = arr.reduce((s: number, v: number) => s + (v - mean) ** 2, 0) / arr.length;
  const std = Math.sqrt(variance) || 1;
  return (v: number | null | undefined) =>
    v == null || Number.isNaN(v) ? 0 : (v - mean) / std;
}

function minMaxNorm(values: number[]) {
  const arr = values.filter((v) => v != null && !Number.isNaN(v));
  if (arr.length === 0) return () => 50;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min || 1;
  return (v: number | null | undefined) =>
    v == null || Number.isNaN(v) ? 50 : ((v - min) / range) * 100;
}

export interface CalculateQualityScoresResult {
  entitiesProcessed: number;
  top5: { filer: string; filerId: number; score: number; rank: number }[];
}

interface HedgeFundIdentityRow {
  entity_id: string | null;
  filer_id: number;
  filer: string | null;
  first_date_13f_filed: string | null;
}

interface EntityRow {
  entityId: string;
  filerId: number;
  filer: string | null;
  values: Record<string, number | null>;
}

type EfvRow = {
  entity_id: string;
  factor_id: string;
  value_num: number | null;
  period_key: string;
};

@Injectable()
export class HedgeFundQualityScoreService {
  private adminClient: SupabaseClient | null = null;

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private buildEfvLookup(
    efvRows: EfvRow[],
    factorKeyById: Record<string, string>,
  ): Map<string, number | null> {
    const lookup = new Map<string, number | null>();
    for (const row of efvRows) {
      const factorKey = factorKeyById[row.factor_id];
      if (!factorKey) continue;
      lookup.set(`${row.entity_id}:${factorKey}:${row.period_key}`, row.value_num);
    }
    return lookup;
  }

  private async loadEntityFactorValues(entityIds: string[]): Promise<EfvRow[]> {
    if (!this.adminClient || entityIds.length === 0) return [];

    const factorKeys = allHedgeFundFactorKeysForLookup();
    const { data: factors, error: factorsError } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', factorKeys);

    if (factorsError) throw new Error(`Failed to fetch factors: ${factorsError.message}`);
    const factorIds = (factors ?? []).map((f) => f.id as string);
    if (factorIds.length === 0) return [];

    const rows: EfvRow[] = [];
    for (const entityChunk of chunkArray(entityIds, ENTITY_BATCH)) {
      const { data, error } = await this.adminClient
        .from('entity_factor_values')
        .select('entity_id, factor_id, value_num, period_key')
        .in('entity_id', entityChunk)
        .in('factor_id', factorIds)
        .eq('model_version', MODEL_VERSION);

      if (error) throw new Error(`Failed to fetch entity_factor_values: ${error.message}`);
      rows.push(...((data ?? []) as EfvRow[]));
    }
    return rows;
  }

  async calculateQualityScores(): Promise<CalculateQualityScoresResult> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }

    const { data: funds, error: fundsError } = await this.adminClient
      .from('hedge_funds')
      .select(HEDGE_FUND_IDENTITY_SELECT);

    if (fundsError) throw new Error(`Failed to fetch hedge funds: ${fundsError.message}`);
    const fundRows = (funds ?? []) as unknown as HedgeFundIdentityRow[];
    if (!fundRows.length) return { entitiesProcessed: 0, top5: [] };

    const currentYear = new Date().getFullYear();
    const now = new Date().toISOString();

    const { data: yearsActiveFactor, error: yearsActiveFactorError } = await this.adminClient
      .from('factors')
      .select('id')
      .eq('key', 'years_active')
      .maybeSingle();

    if (yearsActiveFactorError) {
      throw new Error(`Failed to fetch years_active factor: ${yearsActiveFactorError.message}`);
    }

    const yearsActiveRows: {
      entity_id: string;
      factor_id: string;
      value_num: number;
      updated_at: string;
      model_version: string;
      period_key: string;
    }[] = [];

    for (const fund of fundRows) {
      let entityId = fund.entity_id;
      if (!entityId) {
        const { data: upserted } = await this.adminClient
          .from('entities')
          .upsert(
            {
              entity_type: 'hedge_fund',
              key: String(fund.filer_id),
              name: fund.filer ?? null,
            },
            { onConflict: 'key', ignoreDuplicates: false },
          )
          .select('id')
          .single();
        entityId = upserted?.id ?? null;
        if (!entityId) {
          const { data: existing } = await this.adminClient
            .from('entities')
            .select('id')
            .eq('key', String(fund.filer_id))
            .single();
          entityId = existing?.id ?? null;
        }
        if (entityId) {
          await this.adminClient
            .from('hedge_funds')
            .update({ entity_id: entityId })
            .eq('filer_id', fund.filer_id);
          fund.entity_id = entityId;
        }
      }
      if (!entityId || !yearsActiveFactor?.id) continue;

      const yearsActive =
        fund.first_date_13f_filed != null
          ? currentYear - new Date(fund.first_date_13f_filed).getFullYear()
          : 0;

      yearsActiveRows.push({
        entity_id: entityId,
        factor_id: yearsActiveFactor.id,
        value_num: yearsActive,
        updated_at: now,
        model_version: MODEL_VERSION,
        period_key: 'na',
      });
    }

    for (const chunk of chunkArray(yearsActiveRows, 100)) {
      const { error: yearsActiveError } = await this.adminClient
        .from('entity_factor_values')
        .upsert(chunk, { onConflict: 'entity_id,factor_id,model_version,period_key' });

      if (yearsActiveError) {
        throw new Error(`Failed to upsert years_active: ${yearsActiveError.message}`);
      }
    }

    const { data: entitiesWithEntityId, error: entitiesError } = await this.adminClient
      .from('hedge_funds')
      .select(HEDGE_FUND_IDENTITY_SELECT)
      .not('entity_id', 'is', null);

    if (entitiesError) throw new Error(`Failed to fetch hedge funds: ${entitiesError.message}`);

    const identityRows = (entitiesWithEntityId ?? []) as unknown as HedgeFundIdentityRow[];
    const entityIds = identityRows.map((r) => r.entity_id!);

    const factorKeys = allHedgeFundFactorKeysForLookup();
    const { data: factors, error: factorsError } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', factorKeys);

    if (factorsError) throw new Error(`Failed to fetch factors: ${factorsError.message}`);
    const factorKeyById = Object.fromEntries((factors ?? []).map((f) => [f.id as string, f.key as string]));

    const efvRows = await this.loadEntityFactorValues(entityIds);
    const efvLookup = this.buildEfvLookup(efvRows, factorKeyById);

    const entityRows: EntityRow[] = identityRows.map((r) => {
      const values: Record<string, number | null> = {};
      for (const col of SCORE_METRIC_COLUMNS) {
        const resolved = resolveHedgeFundMetricValue(efvLookup, r.entity_id!, col);
        if (col === 'etf_aum_pct' || col === 'option_aum_pct') {
          values[col] = resolved ?? 0;
        } else {
          values[col] = resolved;
        }
      }
      values.years_active =
        r.first_date_13f_filed != null
          ? currentYear - new Date(r.first_date_13f_filed).getFullYear()
          : efvLookup.get(`${r.entity_id}:years_active:na`) ?? 0;

      return {
        entityId: r.entity_id!,
        filerId: r.filer_id,
        filer: r.filer ?? null,
        values,
      };
    });

    const val = (r: EntityRow, k: string): number => (r.values[k] as number) ?? 0;
    const z = (k: string) => zscore(entityRows.map((r) => val(r, k) as number | null));

    const zPerf3 = z('perf_3_yr_annualized');
    const zPerf5 = z('perf_5_yr_annualized');
    const zPerf7 = z('perf_7_yr_annualized');
    const zPerfMgr5 = z('perf_mgr_wt_5_yr_annualized');
    const zAlpha = z('alpha_3_yr');
    const zSortino = z('sortino_3_yr_equal_weight');
    const zStddev = z('stddev_3_yr');
    const zPct10 = z('pct_in_top_10');
    const zAvgTop10 = z('avg_time_in_top_10');
    const zAvgHeld = z('avg_time_held');
    const zTurnover = z('turnover');
    const zPerf10 = z('perf_10_yr_annualized');

    const betaMinus1 = entityRows.map((r) => (val(r, 'beta_5_yr') || 0) - 1);
    const zBetaM1 = zscore(betaMinus1);
    const betaM1ByEntity = new Map(entityRows.map((r, i) => [r.entityId, zBetaM1(betaMinus1[i])]));

    const rawPerf = entityRows.map(
      (r) =>
        0.25 * zPerf3(val(r, 'perf_3_yr_annualized')) +
        0.35 * zPerf5(val(r, 'perf_5_yr_annualized')) +
        0.15 * zPerf7(val(r, 'perf_7_yr_annualized')) +
        0.15 * zPerfMgr5(val(r, 'perf_mgr_wt_5_yr_annualized')) +
        0.1 * zAlpha(val(r, 'alpha_3_yr')),
    );
    const rawRisk = entityRows.map(
      (r) =>
        0.5 * zSortino(val(r, 'sortino_3_yr_equal_weight')) -
        0.3 * zStddev(val(r, 'stddev_3_yr')) -
        0.2 * Math.abs(betaM1ByEntity.get(r.entityId) ?? 0),
    );
    const rawConv = entityRows.map(
      (r) =>
        0.35 * zPct10(val(r, 'pct_in_top_10')) +
        0.25 * zAvgTop10(val(r, 'avg_time_in_top_10')) +
        0.25 * zAvgHeld(val(r, 'avg_time_held')) -
        0.15 * zTurnover(val(r, 'turnover')),
    );
    const rawInst = entityRows.map((r) => {
      const aum = val(r, 'f_13f_aum') || 0;
      return (
        0.4 * Math.log(Math.max(1, aum)) +
        0.3 * val(r, 'years_active') +
        0.3 * zPerf10(val(r, 'perf_10_yr_annualized'))
      );
    });
    const rawPos = entityRows.map(
      (r) =>
        0.5 * (1 - val(r, 'etf_aum_pct')) +
        0.3 * (1 - val(r, 'option_aum_pct')) -
        0.2 * val(r, 'put_aum_pct'),
    );

    const normPerf = minMaxNorm(rawPerf);
    const normRisk = minMaxNorm(rawRisk);
    const normConv = minMaxNorm(rawConv);
    const normInst = minMaxNorm(rawInst);
    const normPos = minMaxNorm(rawPos);

    const normPerfArr = rawPerf.map(normPerf);
    const normRiskArr = rawRisk.map(normRisk);
    const normConvArr = rawConv.map(normConv);
    const normInstArr = rawInst.map(normInst);
    const normPosArr = rawPos.map(normPos);

    const finalRaw = entityRows.map(
      (_, i) =>
        0.3 * normPerfArr[i] +
        0.25 * normRiskArr[i] +
        0.2 * normConvArr[i] +
        0.15 * normInstArr[i] +
        0.1 * normPosArr[i],
    );
    const normFinal = minMaxNorm(finalRaw);
    const finalScores = finalRaw.map(normFinal);

    interface RankedRow {
      entityId: string;
      filerId: number;
      filer: string | null;
      perf: number;
      risk: number;
      conv: number;
      inst: number;
      pos: number;
      final: number;
      rank: number;
    }
    const ranked: RankedRow[] = entityRows
      .map((r, i) => ({
        entityId: r.entityId,
        filerId: r.filerId,
        filer: r.filer,
        perf: normPerfArr[i],
        risk: normRiskArr[i],
        conv: normConvArr[i],
        inst: normInstArr[i],
        pos: normPosArr[i],
        final: finalScores[i],
        rank: 0,
      }))
      .sort((a, b) => b.final - a.final);

    ranked.forEach((r, i) => {
      r.rank = i + 1;
    });

    const { data: formulas, error: formulasError } = await this.adminClient
      .from('formulas')
      .select('id, key')
      .in('key', [
        'hedge_fund_performance',
        'hedge_fund_risk',
        'hedge_fund_precision',
        'hedge_fund_institutional_strength',
        'hedge_fund_positioning',
        'hedge_fund_quality_score',
      ]);

    if (formulasError) throw new Error(`Failed to fetch formulas: ${formulasError.message}`);
    const formulaIdByKey = Object.fromEntries((formulas ?? []).map((f) => [f.key, f.id]));

    const subFormulaKeys = [
      'hedge_fund_performance',
      'hedge_fund_risk',
      'hedge_fund_precision',
      'hedge_fund_institutional_strength',
      'hedge_fund_positioning',
    ];
    const subCols = ['perf', 'risk', 'conv', 'inst', 'pos'];

    const scoreRows: {
      entity_id: string;
      formula_id: string;
      score: number;
      rank: number | null;
      explanation: Record<string, unknown>;
      updated_at: string;
    }[] = [];

    for (const r of ranked) {
      for (let i = 0; i < subFormulaKeys.length; i++) {
        const key = subFormulaKeys[i];
        const formulaId = formulaIdByKey[key];
        if (!formulaId) continue;
        const score = r[subCols[i] as keyof RankedRow] as number;
        scoreRows.push({
          entity_id: r.entityId,
          formula_id: formulaId,
          score,
          rank: null,
          explanation: { component: key },
          updated_at: now,
        });
      }
      const mainFormulaId = formulaIdByKey.hedge_fund_quality_score;
      if (mainFormulaId) {
        scoreRows.push({
          entity_id: r.entityId,
          formula_id: mainFormulaId,
          score: r.final,
          rank: r.rank,
          explanation: {
            hedge_fund_performance: r.perf,
            hedge_fund_risk: r.risk,
            hedge_fund_precision: r.conv,
            hedge_fund_institutional_strength: r.inst,
            hedge_fund_positioning: r.pos,
          } as Record<string, unknown>,
          updated_at: now,
        });
      }
    }

    const SCORE_BATCH = 100;
    for (let i = 0; i < scoreRows.length; i += SCORE_BATCH) {
      const chunk = scoreRows.slice(i, i + SCORE_BATCH);
      const { error: scoreError } = await this.adminClient
        .from('entity_scores_current')
        .upsert(chunk, { onConflict: 'entity_id,formula_id' });
      if (scoreError) throw new Error(`Failed to upsert entity_scores_current: ${scoreError.message}`);
    }

    const historyRows = scoreRows.map((row) => ({
      entity_id: row.entity_id,
      formula_id: row.formula_id,
      score: row.score,
    }));
    for (let i = 0; i < historyRows.length; i += SCORE_BATCH) {
      const chunk = historyRows.slice(i, i + SCORE_BATCH);
      await this.adminClient.from('entity_scores_history').insert(chunk);
    }

    const top5 = ranked.slice(0, 5).map((r) => ({
      filer: String(r.filer || r.filerId),
      filerId: r.filerId,
      score: r.final,
      rank: r.rank,
    }));

    return {
      entitiesProcessed: ranked.length,
      top5,
    };
  }
}
