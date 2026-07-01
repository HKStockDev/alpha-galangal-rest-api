const { Client } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const HEDGE_FUND_IDENTITY_SELECT =
  'filer_id, entity_id, filer, first_date_13f_filed';

const HEDGE_FUND_COL_TO_FACTOR_AND_PERIOD = {
  perf_3_yr_annualized: { factorKey: 'perf_annualized', periodKey: '3y' },
  perf_5_yr_annualized: { factorKey: 'perf_annualized', periodKey: '5y' },
  perf_7_yr_annualized: { factorKey: 'perf_annualized', periodKey: '7y' },
  perf_10_yr_annualized: { factorKey: 'perf_annualized', periodKey: '10y' },
  perf_mgr_wt_5_yr_annualized: { factorKey: 'perf_mgr_wt_annualized', periodKey: '5y' },
  alpha_3_yr: { factorKey: 'alpha', periodKey: '3y' },
  sortino_3_yr_equal_weight: { factorKey: 'sortino_equal_weight', periodKey: '3y' },
  stddev_3_yr: { factorKey: 'stddev', periodKey: '3y' },
  beta_5_yr: { factorKey: 'beta', periodKey: '5y' },
  pct_in_top_10: { factorKey: 'pct_in_top_10', periodKey: 'na' },
  avg_time_in_top_10: { factorKey: 'avg_time_in_top_10', periodKey: 'na' },
  avg_time_held: { factorKey: 'avg_time_held', periodKey: 'na' },
  turnover: { factorKey: 'turnover', periodKey: 'na' },
  f_13f_aum: { factorKey: 'f_13f_aum', periodKey: 'na' },
  etf_aum_pct: { factorKey: 'etf_aum_pct', periodKey: 'na' },
  option_aum_pct: { factorKey: 'option_aum_pct', periodKey: 'na' },
  put_aum_pct: { factorKey: 'put_aum_pct', periodKey: 'na' },
};

const HEDGE_FUND_FACTOR_KEY_ALIASES = {
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

const SCORE_METRIC_COLUMNS = Object.keys(HEDGE_FUND_COL_TO_FACTOR_AND_PERIOD);
const MODEL_VERSION = 'v1';

function expandHedgeFundFactorKeys(canonicalKey) {
  const aliases = HEDGE_FUND_FACTOR_KEY_ALIASES[canonicalKey] ?? [];
  return [canonicalKey, ...aliases];
}

function allHedgeFundFactorKeysForLookup() {
  const keys = new Set();
  for (const spec of Object.values(HEDGE_FUND_COL_TO_FACTOR_AND_PERIOD)) {
    for (const key of expandHedgeFundFactorKeys(spec.factorKey)) {
      keys.add(key);
    }
  }
  keys.add('years_active');
  return [...keys];
}

function resolveHedgeFundMetricValue(lookup, entityId, col) {
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

function zscore(values) {
  const arr = values.filter((v) => v != null && !Number.isNaN(v));
  if (arr.length === 0) return () => 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  const std = Math.sqrt(variance) || 1;
  return (v) =>
    v == null || Number.isNaN(v) ? 0 : (v - mean) / std;
}

function minMaxNorm(values) {
  const arr = values.filter((v) => v != null && !Number.isNaN(v));
  if (arr.length === 0) return () => 50;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min || 1;
  return (v) =>
    v == null || Number.isNaN(v) ? 50 : ((v - min) / range) * 100;
}

async function run() {
  const projectRef =
    process.env.SUPABASE_PROJECT_ID ||
    new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  const client = new Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const { rows: funds } = await client.query(
      `select ${HEDGE_FUND_IDENTITY_SELECT} from public.hedge_funds`
    );

    if (funds.length === 0) {
      console.log('No hedge funds found. Exiting.');
      return;
    }

    const currentYear = new Date().getFullYear();
    const factorKeys = allHedgeFundFactorKeysForLookup();
    const { rows: factors } = await client.query(
      `select id, key from public.factors where key = any($1)`,
      [factorKeys]
    );
    const factorIdByKey = Object.fromEntries(factors.map((f) => [f.key, f.id]));
    const factorKeyById = Object.fromEntries(factors.map((f) => [f.id, f.key]));

    for (const fund of funds) {
      let entityId = fund.entity_id;
      if (!entityId) {
        const { rows: inserted } = await client.query(
          `insert into public.entities (entity_type, key, name)
           values ('hedge_fund', $1, $2)
           on conflict (key) do update set name = excluded.name
           returning id`,
          [String(fund.filer_id), fund.filer || null]
        );
        entityId = inserted[0]?.id;
        if (!entityId) {
          const { rows: existing } = await client.query(
            `select id from public.entities where key = $1`,
            [String(fund.filer_id)]
          );
          entityId = existing[0]?.id;
        }
        if (entityId) {
          await client.query(
            `update public.hedge_funds set entity_id = $1 where filer_id = $2`,
            [entityId, fund.filer_id]
          );
        }
      }
      if (!entityId) continue;

      const yearsActive =
        fund.first_date_13f_filed != null
          ? currentYear - new Date(fund.first_date_13f_filed).getFullYear()
          : 0;

      const yearsActiveFactorId = factorIdByKey.years_active;
      if (yearsActiveFactorId) {
        await client.query(
          `insert into public.entity_factor_values (
             entity_id, factor_id, value_num, updated_at, model_version, period_key
           ) values ($1, $2, $3, now(), $4, 'na')
           on conflict (entity_id, factor_id, model_version, period_key) do update set
             value_num = excluded.value_num, updated_at = now()`,
          [entityId, yearsActiveFactorId, yearsActive, MODEL_VERSION]
        );
      }
    }

    const { rows: entitiesWithEntityId } = await client.query(
      `select ${HEDGE_FUND_IDENTITY_SELECT}
       from public.hedge_funds
       where entity_id is not null`
    );

    const entityIds = entitiesWithEntityId.map((r) => r.entity_id);
    const factorIds = factors.map((f) => f.id);
    const { rows: efvRows } = await client.query(
      `select entity_id, factor_id, value_num, period_key
       from public.entity_factor_values
       where entity_id = any($1::uuid[])
         and factor_id = any($2::uuid[])
         and model_version = $3`,
      [entityIds, factorIds, MODEL_VERSION]
    );

    const efvLookup = new Map();
    for (const row of efvRows) {
      const factorKey = factorKeyById[row.factor_id];
      if (!factorKey) continue;
      efvLookup.set(`${row.entity_id}:${factorKey}:${row.period_key}`, row.value_num);
    }

    const entityRows = entitiesWithEntityId.map((r) => {
      const values = {};
      for (const col of SCORE_METRIC_COLUMNS) {
        const resolved = resolveHedgeFundMetricValue(efvLookup, r.entity_id, col);
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
        entityId: r.entity_id,
        filerId: r.filer_id,
        filer: r.filer,
        values,
      };
    });

    const val = (r, k) => r.values[k] ?? 0;
    const z = (k) => zscore(entityRows.map((r) => val(r, k)));

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
    const betaM1ByEntity = new Map(
      entityRows.map((r, i) => [r.entityId, zBetaM1(betaMinus1[i])])
    );

    const rawPerf = entityRows.map((r) =>
      0.25 * zPerf3(val(r, 'perf_3_yr_annualized')) +
      0.35 * zPerf5(val(r, 'perf_5_yr_annualized')) +
      0.15 * zPerf7(val(r, 'perf_7_yr_annualized')) +
      0.15 * zPerfMgr5(val(r, 'perf_mgr_wt_5_yr_annualized')) +
      0.1 * zAlpha(val(r, 'alpha_3_yr'))
    );
    const rawRisk = entityRows.map((r) =>
      0.5 * zSortino(val(r, 'sortino_3_yr_equal_weight')) -
      0.3 * zStddev(val(r, 'stddev_3_yr')) -
      0.2 * Math.abs(betaM1ByEntity.get(r.entityId) ?? 0)
    );
    const rawConv = entityRows.map((r) =>
      0.35 * zPct10(val(r, 'pct_in_top_10')) +
      0.25 * zAvgTop10(val(r, 'avg_time_in_top_10')) +
      0.25 * zAvgHeld(val(r, 'avg_time_held')) -
      0.15 * zTurnover(val(r, 'turnover'))
    );
    const rawInst = entityRows.map((r) => {
      const aum = val(r, 'f_13f_aum') || 0;
      return (
        0.4 * Math.log(Math.max(1, aum)) +
        0.3 * val(r, 'years_active') +
        0.3 * zPerf10(val(r, 'perf_10_yr_annualized'))
      );
    });
    const rawPos = entityRows.map((r) =>
      0.5 * (1 - val(r, 'etf_aum_pct')) +
      0.3 * (1 - val(r, 'option_aum_pct')) -
      0.2 * val(r, 'put_aum_pct')
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

    const finalRaw = entityRows.map((r, i) =>
      0.3 * normPerfArr[i] +
      0.25 * normRiskArr[i] +
      0.2 * normConvArr[i] +
      0.15 * normInstArr[i] +
      0.1 * normPosArr[i]
    );
    const normFinal = minMaxNorm(finalRaw);
    const finalScores = finalRaw.map(normFinal);

    const ranked = entityRows
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
      }))
      .sort((a, b) => b.final - a.final);

    ranked.forEach((r, i) => {
      r.rank = i + 1;
    });

    const { rows: formulas } = await client.query(
      `select id, key from public.formulas where key = any($1)`,
      [
        'hedge_fund_performance',
        'hedge_fund_risk',
        'hedge_fund_conviction',
        'hedge_fund_institutional_strength',
        'hedge_fund_positioning',
        'hedge_fund_quality_score',
      ]
    );
    const formulaIdByKey = Object.fromEntries(
      formulas.map((f) => [f.key, f.id])
    );

    const subFormulaKeys = [
      'hedge_fund_performance',
      'hedge_fund_risk',
      'hedge_fund_conviction',
      'hedge_fund_institutional_strength',
      'hedge_fund_positioning',
    ];
    const subCols = ['perf', 'risk', 'conv', 'inst', 'pos'];

    for (const r of ranked) {
      for (let i = 0; i < subFormulaKeys.length; i++) {
        const key = subFormulaKeys[i];
        const formulaId = formulaIdByKey[key];
        if (!formulaId) continue;
        const score = r[subCols[i]];
        await client.query(
          `insert into public.entity_scores_current (entity_id, formula_id, score, rank, explanation, updated_at)
           values ($1, $2, $3, null, $4, now())
           on conflict (entity_id, formula_id) do update set
             score = excluded.score, explanation = excluded.explanation, updated_at = now()`,
          [r.entityId, formulaId, score, JSON.stringify({ component: key })]
        );
      }
      const mainFormulaId = formulaIdByKey.hedge_fund_quality_score;
      if (mainFormulaId) {
        await client.query(
          `insert into public.entity_scores_current (entity_id, formula_id, score, rank, explanation, updated_at)
           values ($1, $2, $3, $4, $5, now())
           on conflict (entity_id, formula_id) do update set
             score = excluded.score, rank = excluded.rank, explanation = excluded.explanation, updated_at = now()`,
          [
            r.entityId,
            mainFormulaId,
            r.final,
            r.rank,
            JSON.stringify({
              hedge_fund_performance: r.perf,
              hedge_fund_risk: r.risk,
              hedge_fund_conviction: r.conv,
              hedge_fund_institutional_strength: r.inst,
              hedge_fund_positioning: r.pos,
            }),
          ]
        );
      }
    }

    console.log(
      `Calculated Hedge Fund Quality Score for ${ranked.length} entities.`
    );
    console.log(
      'Top 5:',
      ranked.slice(0, 5).map((r) => `${r.filer || r.filerId}: ${r.final.toFixed(1)} (rank ${r.rank})`)
    );
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
