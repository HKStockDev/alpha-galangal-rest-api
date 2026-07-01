export interface FactorAndPeriod {
  factorKey: string;
  periodKey: string;
  periodMonths?: number;
}

export const HEDGE_FUND_COL_TO_FACTOR_AND_PERIOD: Record<string, FactorAndPeriod> = {
  perf_3_yr_annualized: { factorKey: 'perf_annualized', periodKey: '3y', periodMonths: 36 },
  perf_5_yr_annualized: { factorKey: 'perf_annualized', periodKey: '5y', periodMonths: 60 },
  perf_7_yr_annualized: { factorKey: 'perf_annualized', periodKey: '7y', periodMonths: 84 },
  perf_10_yr_annualized: { factorKey: 'perf_annualized', periodKey: '10y', periodMonths: 120 },
  perf_mgr_wt_3_yr_annualized: { factorKey: 'perf_mgr_wt_annualized', periodKey: '3y', periodMonths: 36 },
  perf_mgr_wt_5_yr_annualized: { factorKey: 'perf_mgr_wt_annualized', periodKey: '5y', periodMonths: 60 },
  perf_mgr_wt_7_yr_annualized: { factorKey: 'perf_mgr_wt_annualized', periodKey: '7y', periodMonths: 84 },
  perf_mgr_wt_10_yr_annualized: { factorKey: 'perf_mgr_wt_annualized', periodKey: '10y', periodMonths: 120 },
  alpha_3_yr: { factorKey: 'alpha', periodKey: '3y', periodMonths: 36 },
  sortino_3_yr_equal_weight: { factorKey: 'sortino_equal_weight', periodKey: '3y', periodMonths: 36 },
  stddev_3_yr: { factorKey: 'stddev', periodKey: '3y', periodMonths: 36 },
  beta_5_yr: { factorKey: 'beta', periodKey: '5y', periodMonths: 60 },
  pct_in_top_10: { factorKey: 'pct_in_top_10', periodKey: 'na' },
  avg_time_in_top_10: { factorKey: 'avg_time_in_top_10', periodKey: 'na' },
  avg_time_held: { factorKey: 'avg_time_held', periodKey: 'na' },
  turnover: { factorKey: 'turnover', periodKey: 'na' },
  f_13f_aum: { factorKey: 'f_13f_aum', periodKey: 'na' },
  etf_aum_pct: { factorKey: 'etf_aum_pct', periodKey: 'na' },
  option_aum_pct: { factorKey: 'option_aum_pct', periodKey: 'na' },
  put_aum_pct: { factorKey: 'put_aum_pct', periodKey: 'na' },
};

/** Alternate factor keys from migration backfill, CSV ingest, or seed-era flat keys. */
export const HEDGE_FUND_FACTOR_KEY_ALIASES: Record<string, string[]> = {
  perf_annualized: [
    'perf_annualized_equal',
    'perf_3_yr_annualized',
    'perf_5_yr_annualized',
    'perf_7_yr_annualized',
    'perf_10_yr_annualized',
  ],
  perf_mgr_wt_annualized: ['perf_annualized_mgr_wt', 'perf_mgr_wt_5_yr_annualized'],
  alpha: ['alpha_3_yr'],
  sortino_equal_weight: ['sortino_3_yr_equal_weight'],
  stddev: ['stddev_3_yr'],
  beta: ['beta_5_yr'],
  f_13f_aum: ['aum_13f'],
};

export function expandHedgeFundFactorKeys(canonicalKey: string): string[] {
  const aliases = HEDGE_FUND_FACTOR_KEY_ALIASES[canonicalKey] ?? [];
  return [canonicalKey, ...aliases];
}

export function allHedgeFundFactorKeysForLookup(): string[] {
  const keys = new Set<string>();
  for (const spec of Object.values(HEDGE_FUND_COL_TO_FACTOR_AND_PERIOD)) {
    for (const key of expandHedgeFundFactorKeys(spec.factorKey)) {
      keys.add(key);
    }
  }
  keys.add('years_active');
  return [...keys];
}

export const SCORE_METRIC_COLUMNS = Object.keys(HEDGE_FUND_COL_TO_FACTOR_AND_PERIOD);

export const NORMALIZED_FACTOR_KEYS = [
  ...new Set(Object.values(HEDGE_FUND_COL_TO_FACTOR_AND_PERIOD).map((x) => x.factorKey)),
  'years_active',
];

export const MODEL_VERSION = 'v1';

export function resolveHedgeFundMetricValue(
  lookup: Map<string, number | null>,
  entityId: string,
  col: string,
): number | null {
  const spec = HEDGE_FUND_COL_TO_FACTOR_AND_PERIOD[col];
  if (!spec) return null;

  const keysToTry = expandHedgeFundFactorKeys(spec.factorKey);

  const canonical = lookup.get(`${entityId}:${spec.factorKey}:${spec.periodKey}`);
  if (canonical != null && !Number.isNaN(canonical)) return canonical;

  for (const alias of keysToTry.slice(1)) {
    const withPeriod = lookup.get(`${entityId}:${alias}:${spec.periodKey}`);
    if (withPeriod != null && !Number.isNaN(withPeriod)) return withPeriod;
  }

  for (const alias of keysToTry.slice(1)) {
    const flat = lookup.get(`${entityId}:${alias}:na`);
    if (flat != null && !Number.isNaN(flat)) return flat;
  }

  const colFlat = lookup.get(`${entityId}:${col}:na`);
  if (colFlat != null && !Number.isNaN(colFlat)) return colFlat;

  return null;
}
