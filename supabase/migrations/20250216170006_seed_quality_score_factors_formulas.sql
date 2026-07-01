insert into public.factors (key, name, value_type) values
  ('perf_3_yr_annualized', '3 Yr Perf Annualized', 'number'),
  ('perf_5_yr_annualized', '5 Yr Perf Annualized', 'number'),
  ('perf_7_yr_annualized', '7 Yr Perf Annualized', 'number'),
  ('perf_10_yr_annualized', '10 Yr Perf Annualized', 'number'),
  ('perf_mgr_wt_5_yr_annualized', '5 Yr Perf Mgr-Weight Annualized', 'number'),
  ('alpha_3_yr', '3 Yr Alpha', 'number'),
  ('sortino_3_yr_equal_weight', '3-Year Sortino Equal Weight', 'number'),
  ('stddev_3_yr', 'STDDEV 3-Year', 'number'),
  ('beta_5_yr', '5 Yr Beta', 'number'),
  ('pct_in_top_10', '% in Top 10', 'number'),
  ('avg_time_in_top_10', 'Avg Time in Top 10', 'number'),
  ('avg_time_held', 'Avg Time Held', 'number'),
  ('turnover', 'Turnover', 'number'),
  ('f_13f_aum', '13F AUM', 'number'),
  ('etf_aum_pct', 'ETF AUM %', 'number'),
  ('option_aum_pct', 'Option AUM %', 'number'),
  ('put_aum_pct', 'PUT AUM %', 'number'),
  ('years_active', 'Years Active', 'number')
on conflict (key) do nothing;

insert into public.formulas (key, name, output_type, definition) values
  ('hedge_fund_performance', 'Hedge Fund Performance', 'number', '{"type":"weighted_zscore","terms":[{"w":0.25,"f":"perf_3_yr_annualized"},{"w":0.35,"f":"perf_5_yr_annualized"},{"w":0.15,"f":"perf_7_yr_annualized"},{"w":0.15,"f":"perf_mgr_wt_5_yr_annualized"},{"w":0.1,"f":"alpha_3_yr"}]}'::jsonb),
  ('hedge_fund_risk', 'Hedge Fund Risk', 'number', '{"type":"risk","sortino":"sortino_3_yr_equal_weight","stddev":"stddev_3_yr","beta":"beta_5_yr"}'::jsonb),
  ('hedge_fund_precision', 'Hedge Fund Precision', 'number', '{"type":"weighted_zscore","terms":[{"w":0.35,"f":"pct_in_top_10"},{"w":0.25,"f":"avg_time_in_top_10"},{"w":0.25,"f":"avg_time_held"},{"w":-0.15,"f":"turnover"}]}'::jsonb),
  ('hedge_fund_institutional_strength', 'Hedge Fund Institutional Strength', 'number', '{"type":"institutional","log_aum":"f_13f_aum","years_active":"years_active","perf_10":"perf_10_yr_annualized"}'::jsonb),
  ('hedge_fund_positioning', 'Hedge Fund Positioning', 'number', '{"type":"positioning","etf":"etf_aum_pct","option":"option_aum_pct","put":"put_aum_pct"}'::jsonb),
  ('hedge_fund_quality_score', 'Hedge Fund Quality Score', 'number', '{"type":"composite","weights":{"hedge_fund_performance":0.3,"hedge_fund_risk":0.25,"hedge_fund_precision":0.2,"hedge_fund_institutional_strength":0.15,"hedge_fund_positioning":0.1}}'::jsonb)
on conflict (key) do nothing;
