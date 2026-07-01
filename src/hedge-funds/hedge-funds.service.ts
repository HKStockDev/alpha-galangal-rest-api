import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';

const HEDGE_FUNDS_IDENTITY_KEYS = new Set([
  'filer_id',
  'filer',
  'entity_id',
  'business_phone',
  'fund_size',
  'filer_cik',
  'filer_zip_code',
  'city',
  'state',
  'country',
  'investing_styles',
  'fund_classifications',
  'earliest_13f',
  'first_date_13f_filed',
  'date_filed',
]);

const CSV_TO_DB: Record<string, string> = {
  filer_id: 'filer_id',
  Filer: 'filer',
  'Business Phone': 'business_phone',
  'WhaleScore 1 Yr Equal-Wt': 'whale_score_1_yr_equal_wt',
  'WhaleScore 1 Yr Mgr-Wt': 'whale_score_1_yr_mgr_wt',
  'WhaleScore Qtr Equal-Wt': 'whale_score_qtr_equal_wt',
  'Fund Size': 'fund_size',
  Holdings: 'holdings',
  '13F AUM': 'f_13f_aum',
  Turnover: 'turnover',
  '% in Top 10': 'pct_in_top_10',
  'Perf Equal QoQ': 'perf_equal_qoq',
  'Perf Equal All': 'perf_equal_all',
  'Perf Mgr QoQ': 'perf_mgr_qoq',
  'Perf Mgr All': 'perf_mgr_all',
  'Earliest 13F': 'earliest_13f',
  'Perf Equal 1 Year': 'perf_equal_1_year',
  'Perf Equal 5 Year': 'perf_equal_5_year',
  'Perf Mgr-Wt 1 Year': 'perf_mgr_wt_1_year',
  'Perf Mgr-Wt 5 Year': 'perf_mgr_wt_5_year',
  '3 Yr Perf Annualized': 'perf_3_yr_annualized',
  '5 Yr Perf Annualized': 'perf_5_yr_annualized',
  '7 Yr Perf Annualized': 'perf_7_yr_annualized',
  '10 Yr Perf Annualized': 'perf_10_yr_annualized',
  '3 Yr Perf Mgr-Weight Annualized': 'perf_mgr_wt_3_yr_annualized',
  '5 Yr Perf Mgr-Weight Annualized': 'perf_mgr_wt_5_yr_annualized',
  '7 Yr Perf Mgr-Weight Annualized': 'perf_mgr_wt_7_yr_annualized',
  '10 Yr Perf Mgr-Weight Annualized': 'perf_mgr_wt_10_yr_annualized',
  'Avg Time in Top 10': 'avg_time_in_top_10',
  'Avg Time Held': 'avg_time_held',
  'Filer CIK': 'filer_cik',
  'Filer Zip Code': 'filer_zip_code',
  'Change in MV': 'change_in_mv',
  'Put Count': 'put_count',
  'Call Count': 'call_count',
  'Prior MV': 'prior_mv',
  State: 'state',
  City: 'city',
  'Shares Traded': 'shares_traded',
  '3-Year Sortino Equal Weight': 'sortino_3_yr_equal_weight',
  'STDDEV 3-Year': 'stddev_3_yr',
  '5 Yr Beta': 'beta_5_yr',
  '3 Yr Alpha': 'alpha_3_yr',
  'ETF AUM': 'etf_aum',
  'ETF AUM %': 'etf_aum_pct',
  'Option AUM': 'option_aum',
  'Option AUM Percentage': 'option_aum_pct',
  'Call AUM': 'call_aum',
  'Call AUM Percentage': 'call_aum_pct',
  'PUT AUM': 'put_aum',
  'PUT AUM Percentage': 'put_aum_pct',
  'Investing Styles': 'investing_styles',
  'Fund Classifications': 'fund_classifications',
  'First Date 13F Was Filed': 'first_date_13f_filed',
  'Previous 13F AUM': 'previous_13f_aum',
  Country: 'country',
  'Date Filed': 'date_filed',
};

const NUMERIC_KEYS = new Set([
  'holdings', 'f_13f_aum', 'turnover', 'pct_in_top_10', 'perf_equal_qoq', 'perf_equal_all',
  'perf_mgr_qoq', 'perf_mgr_all', 'perf_equal_1_year', 'perf_equal_5_year', 'perf_mgr_wt_1_year',
  'perf_mgr_wt_5_year', 'perf_3_yr_annualized', 'perf_5_yr_annualized', 'perf_7_yr_annualized',
  'perf_10_yr_annualized', 'perf_mgr_wt_3_yr_annualized', 'perf_mgr_wt_5_yr_annualized',
  'perf_mgr_wt_7_yr_annualized', 'perf_mgr_wt_10_yr_annualized', 'avg_time_in_top_10',
  'avg_time_held', 'change_in_mv', 'prior_mv', 'shares_traded', 'sortino_3_yr_equal_weight',
  'stddev_3_yr', 'beta_5_yr', 'alpha_3_yr', 'etf_aum', 'etf_aum_pct', 'option_aum',
  'option_aum_pct', 'call_aum', 'call_aum_pct', 'put_aum', 'put_aum_pct', 'previous_13f_aum',
  'whale_score_1_yr_equal_wt', 'whale_score_1_yr_mgr_wt', 'whale_score_qtr_equal_wt',
  'put_count', 'call_count',
]);

const INTEGER_KEYS = new Set(['filer_id', 'whale_score_1_yr_equal_wt', 'whale_score_1_yr_mgr_wt', 'whale_score_qtr_equal_wt', 'put_count', 'call_count']);
const TIMESTAMP_KEYS = new Set(['earliest_13f', 'first_date_13f_filed', 'date_filed']);

const MODEL_VERSION = 'v1';
const SOURCE_WHALEWISDOM = 'whalewisdom_csv';

function coerceValue(key: string, raw: string): unknown {
  const s = raw?.trim() ?? '';
  if (s === '') return null;
  if (INTEGER_KEYS.has(key)) {
    const n = parseFloat(s);
    return isNaN(n) ? null : Math.floor(n);
  }
  if (NUMERIC_KEYS.has(key)) {
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  if (TIMESTAMP_KEYS.has(key)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return s;
}

function deriveFactorAndPeriod(
  dbColumnName: string,
): { factorKey: string; periodKey: string; periodMonths: number | null } {
  const col = dbColumnName;
  const yrMatch = col.match(/_(\d+)_yr_/) || col.match(/_(\d+)_yr$/);
  if (yrMatch) {
    const n = parseInt(yrMatch[1], 10);
    const factorKey = col.replace(/_(\d+)_yr_/g, '_').replace(/_(\d+)_yr$/g, '');
    return { factorKey, periodKey: `${n}y`, periodMonths: n * 12 };
  }
  if (/qtr|qoq/i.test(col)) {
    return { factorKey: col, periodKey: '1q', periodMonths: 3 };
  }
  return { factorKey: col, periodKey: 'na', periodMonths: null };
}

@Injectable()
export class HedgeFundsService {
  private adminClient: SupabaseClient | null = null;

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  async uploadCsv(buffer: Buffer): Promise<{ processed: number }> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }

    const records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    const uploadDate = new Date();
    const processedFilerIds: number[] = [];
    const rowsForMetrics: { filer_id: number; date_filed: string | null; metrics: Record<string, number | null> }[] = [];

    for (const row of records) {
      const data: Record<string, unknown> = {};
      for (const [csvKey, dbKey] of Object.entries(CSV_TO_DB)) {
        if (row[csvKey] !== undefined) {
          const v = coerceValue(dbKey, String(row[csvKey]));
          if (v !== null && v !== '') {
            data[dbKey] = v;
          }
        }
      }

      if (!data.filer_id) continue;

      const identityData: Record<string, unknown> = {};
      for (const k of Object.keys(data)) {
        if (HEDGE_FUNDS_IDENTITY_KEYS.has(k)) {
          identityData[k] = data[k];
        }
      }
      const { error } = await this.adminClient.rpc('upsert_hedge_fund', { data: identityData });
      if (error) throw new Error(`Upsert failed for filer_id ${identityData.filer_id}: ${error.message}`);
      processedFilerIds.push(data.filer_id as number);

      const metrics: Record<string, number | null> = {};
      for (const dbKey of Object.keys(data)) {
        if (HEDGE_FUNDS_IDENTITY_KEYS.has(dbKey)) continue;
        const v = data[dbKey];
        if (typeof v === 'number' && !Number.isNaN(v)) {
          metrics[dbKey] = v;
        } else if (typeof v === 'number') {
          metrics[dbKey] = null;
        } else if (v != null && (NUMERIC_KEYS.has(dbKey) || INTEGER_KEYS.has(dbKey))) {
          const n = Number(v);
          metrics[dbKey] = Number.isNaN(n) ? null : n;
        }
      }
      const dateFiled = data.date_filed as string | null | undefined;
      rowsForMetrics.push({
        filer_id: data.filer_id as number,
        date_filed: dateFiled ?? null,
        metrics,
      });
    }

    await this.backfillEntityIds(processedFilerIds);
    await this.ingestMetricsFromRows(rowsForMetrics, uploadDate);

    return { processed: records.length };
  }

  private async ingestMetricsFromRows(
    rows: { filer_id: number; date_filed: string | null; metrics: Record<string, number | null> }[],
    uploadDate: Date,
  ): Promise<void> {
    if (!this.adminClient || rows.length === 0) return;

    const filerIds = [...new Set(rows.map((r) => r.filer_id))];
    const { data: funds } = await this.adminClient
      .from('hedge_funds')
      .select('filer_id, entity_id')
      .in('filer_id', filerIds)
      .not('entity_id', 'is', null);
    const entityIdByFilerId = Object.fromEntries(
      ((funds ?? []) as { filer_id: number; entity_id: string }[]).map((f) => [f.filer_id, f.entity_id]),
    );

    type MetricRow = {
      entity_id: string;
      factor_key: string;
      period_key: string;
      period_months: number | null;
      value_num: number;
      as_of_date: string;
    };
    const metricRows: MetricRow[] = [];
    for (const r of rows) {
      const entityId = entityIdByFilerId[r.filer_id];
      if (!entityId) continue;
      let asOfDate: string;
      if (r.date_filed) {
        const d = new Date(r.date_filed);
        asOfDate = Number.isNaN(d.getTime()) ? uploadDate.toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
      } else {
        asOfDate = uploadDate.toISOString().slice(0, 10);
      }
      for (const [dbKey, value] of Object.entries(r.metrics)) {
        if (value == null || Number.isNaN(value)) continue;
        const { factorKey, periodKey, periodMonths } = deriveFactorAndPeriod(dbKey);
        metricRows.push({
          entity_id: entityId,
          factor_key: factorKey,
          period_key: periodKey,
          period_months: periodMonths,
          value_num: value,
          as_of_date: asOfDate,
        });
      }
    }

    const factorKeys = [...new Set(metricRows.map((m) => m.factor_key))];
    if (factorKeys.length > 0) {
      await this.adminClient.from('factors').upsert(
        factorKeys.map((key) => ({
          key,
          name: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          value_type: 'number',
          description: 'From WhaleWisdom hedge fund CSV.',
          data_grain: 'snapshot',
          period_supported: 'multi',
          statement_type: 'market_data',
        })),
        { onConflict: 'key', ignoreDuplicates: true },
      );
    }

    const { data: factors } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', factorKeys);
    const factorIdByKey = Object.fromEntries((factors ?? []).map((f: { id: string; key: string }) => [f.key, f.id]));

    const now = uploadDate.toISOString();
    type EfvRow = {
      entity_id: string;
      factor_id: string;
      value_num: number;
      updated_at: string;
      model_version: string;
      period_key: string;
      period_months: number | null;
      source: string;
      ingested_at: string;
    };
    const efvRows: EfvRow[] = [];
    for (const m of metricRows) {
      const factorId = factorIdByKey[m.factor_key];
      if (!factorId) continue;
      efvRows.push({
        entity_id: m.entity_id,
        factor_id: factorId,
        value_num: m.value_num,
        updated_at: now,
        model_version: MODEL_VERSION,
        period_key: m.period_key,
        period_months: m.period_months,
        source: SOURCE_WHALEWISDOM,
        ingested_at: now,
      });
    }

    const BATCH = 100;
    for (let i = 0; i < efvRows.length; i += BATCH) {
      await this.adminClient
        .from('entity_factor_values')
        .upsert(efvRows.slice(i, i + BATCH), { onConflict: 'entity_id,factor_id,model_version,period_key' });
    }

    type EfvTsRow = {
      entity_id: string;
      factor_id: string;
      value_num: number;
      period_key: string;
      period_months: number | null;
      model_version: string;
      as_of_date: string;
      source: string;
      ingested_at: string;
      start_date: string;
      end_date: string;
      period_of_report_date: string;
    };
    const tsRows: EfvTsRow[] = [];
    for (const m of metricRows) {
      const factorId = factorIdByKey[m.factor_key];
      if (!factorId) continue;
      tsRows.push({
        entity_id: m.entity_id,
        factor_id: factorId,
        value_num: m.value_num,
        period_key: m.period_key,
        period_months: m.period_months,
        model_version: MODEL_VERSION,
        as_of_date: m.as_of_date,
        source: SOURCE_WHALEWISDOM,
        ingested_at: now,
        start_date: m.as_of_date,
        end_date: m.as_of_date,
        period_of_report_date: m.as_of_date,
      });
    }
    for (let i = 0; i < tsRows.length; i += BATCH) {
      await this.adminClient
        .from('entity_factor_values_ts')
        .upsert(tsRows.slice(i, i + BATCH), {
          onConflict: 'entity_id,factor_id,model_version,period_key,as_of_date',
        });
    }
  }

  private async backfillEntityIds(filerIds: number[]): Promise<void> {
    if (!this.adminClient || filerIds.length === 0) return;
    const { data: missing } = await this.adminClient
      .from('hedge_funds')
      .select('filer_id, filer')
      .in('filer_id', filerIds)
      .is('entity_id', null);
    if (!missing?.length) return;
    for (const row of missing) {
      const { data: entity } = await this.adminClient
        .from('entities')
        .upsert(
          { entity_type: 'hedge_fund', key: String(row.filer_id), name: row.filer ?? null },
          { onConflict: 'key' },
        )
        .select('id')
        .single();
      if (entity?.id) {
        await this.adminClient
          .from('hedge_funds')
          .update({ entity_id: entity.id })
          .eq('filer_id', row.filer_id);
      }
    }
  }

  readonly SORTABLE_COLUMNS = ['filer', 'hedge_fund_quality_score', 'filer_id'] as const;

  async findAll(params: {
    page?: number;
    limit?: number;
    sort?: string;
    order?: 'asc' | 'desc';
    search?: string;
    minScore?: number;
    maxScore?: number;
  }): Promise<{
    data: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }

    const page = Math.max(1, params.page ?? 1);
    const limit = [25, 50, 100].includes(params.limit ?? 25)
      ? (params.limit ?? 25)
      : 25;
    const sortParam = params.sort ?? 'hedge_fund_quality_score';
    const sort: string = this.SORTABLE_COLUMNS.includes(
      sortParam as (typeof this.SORTABLE_COLUMNS)[number],
    )
      ? sortParam
      : 'hedge_fund_quality_score';
    const order = params.order === 'asc' ? 'asc' : 'desc';

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.adminClient
      .from('hedge_funds_list')
      .select('*', { count: 'exact' })
      .order(sort, { ascending: order === 'asc', nullsFirst: false })
      .range(from, to);

    if (params.search) {
      query = query.ilike('filer', `%${params.search.replace(/%/g, '\\%')}%`);
    }
    if (params.minScore != null && !Number.isNaN(params.minScore)) {
      query = query.gte('hedge_fund_quality_score', params.minScore);
    }
    if (params.maxScore != null && !Number.isNaN(params.maxScore)) {
      query = query.lte('hedge_fund_quality_score', params.maxScore);
    }

    const { data, error, count } = await query;

    if (error) throw new Error(`Failed to fetch hedge funds: ${error.message}`);

    const total = count ?? 0;
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: (data ?? []) as Record<string, unknown>[],
      total,
      page,
      limit,
      totalPages,
    };
  }
}
