-- Backfill description, data_grain, period_supported, statement_type for factors that have NULLs

update public.factors
set
  description = '3-year annualized performance return',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'perf_3_yr_annualized' and (description is null or data_grain is null);

update public.factors
set
  description = '5-year annualized performance return',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'perf_5_yr_annualized' and (description is null or data_grain is null);

update public.factors
set
  description = '7-year annualized performance return',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'perf_7_yr_annualized' and (description is null or data_grain is null);

update public.factors
set
  description = '10-year annualized performance return',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'perf_10_yr_annualized' and (description is null or data_grain is null);

update public.factors
set
  description = '5-year manager-weighted annualized performance return',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'perf_mgr_wt_5_yr_annualized' and (description is null or data_grain is null);

update public.factors
set
  description = '3-year alpha vs benchmark',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'alpha_3_yr' and (description is null or data_grain is null);

update public.factors
set
  description = '3-year Sortino ratio (equal weight)',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'sortino_3_yr_equal_weight' and (description is null or data_grain is null);

update public.factors
set
  description = '3-year standard deviation of returns',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'stddev_3_yr' and (description is null or data_grain is null);

update public.factors
set
  description = '5-year beta vs market',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'beta_5_yr' and (description is null or data_grain is null);

update public.factors
set
  description = 'Percentage of portfolio in top 10 holdings',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'custom'
where key = 'pct_in_top_10' and (description is null or data_grain is null);

update public.factors
set
  description = 'Average time holdings spent in top 10',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'custom'
where key = 'avg_time_in_top_10' and (description is null or data_grain is null);

update public.factors
set
  description = 'Average holding period',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'custom'
where key = 'avg_time_held' and (description is null or data_grain is null);

update public.factors
set
  description = 'Portfolio turnover rate',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'custom'
where key = 'turnover' and (description is null or data_grain is null);

update public.factors
set
  description = '13F-reported assets under management',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'market_data'
where key = 'f_13f_aum' and (description is null or data_grain is null);

update public.factors
set
  description = 'ETF allocation as percentage of AUM',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'custom'
where key = 'etf_aum_pct' and (description is null or data_grain is null);

update public.factors
set
  description = 'Option allocation as percentage of AUM',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'custom'
where key = 'option_aum_pct' and (description is null or data_grain is null);

update public.factors
set
  description = 'Put option allocation as percentage of AUM',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'custom'
where key = 'put_aum_pct' and (description is null or data_grain is null);

update public.factors
set
  description = 'Years the fund has been filing 13F',
  data_grain = 'snapshot',
  period_supported = 'none',
  statement_type = 'custom'
where key = 'years_active' and (description is null or data_grain is null);

-- Catch-all: set metadata for any factor still missing it (e.g. future factors)
update public.factors
set
  data_grain = coalesce(data_grain, 'snapshot'),
  period_supported = coalesce(period_supported, 'none'),
  statement_type = coalesce(statement_type, 'custom'),
  description = coalesce(description, name)
where data_grain is null or period_supported is null or statement_type is null;
