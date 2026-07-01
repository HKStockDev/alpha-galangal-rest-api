drop view if exists public.hedge_funds_list;

create view public.hedge_funds_list as
select
  h.filer_id,
  h.filer,
  h.holdings,
  h.f_13f_aum,
  h.turnover,
  h.pct_in_top_10,
  h.perf_3_yr_annualized,
  h.perf_5_yr_annualized,
  h.perf_10_yr_annualized,
  h.alpha_3_yr,
  h.sortino_3_yr_equal_weight,
  h.beta_5_yr,
  h.stddev_3_yr,
  h.option_aum_pct,
  h.etf_aum_pct,
  h.avg_time_held,
  esc.score as hedge_fund_quality_score
from public.hedge_funds h
left join public.entity_scores_current esc on h.entity_id = esc.entity_id
left join public.formulas f on esc.formula_id = f.id and f.key = 'hedge_fund_quality_score';

alter view public.hedge_funds_list set (security_invoker = on);
