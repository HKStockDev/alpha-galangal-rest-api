alter table public.formulas
  add column if not exists display_formula text not null default '',
  add column if not exists description text not null default '';

update public.formulas set display_formula = '0.25×z(perf_3yr) + 0.35×z(perf_5yr) + 0.15×z(perf_7yr) + 0.15×z(perf_mgr_5yr) + 0.10×z(α_3yr)', description = 'Weighted combination of 3Y, 5Y, 7Y and manager-weighted 5Y annualized returns plus 3Y alpha, normalized via z-scores.' where key = 'hedge_fund_performance';
update public.formulas set display_formula = '0.50×z(sortino) − 0.30×z(stddev) − 0.20×|z(β−1)|', description = 'Risk-adjusted score favoring higher Sortino, lower volatility, and beta near 1.' where key = 'hedge_fund_risk';
update public.formulas set display_formula = '0.35×z(pct_top10) + 0.25×z(avg_time_top10) + 0.25×z(avg_held) − 0.15×z(turnover)', description = 'Concentration and holding period (top 10, avg time held) vs turnover.' where key = 'hedge_fund_precision';
update public.formulas set display_formula = '0.40×ln(AUM) + 0.30×years_active + 0.30×z(perf_10yr)', description = 'Size (log 13F AUM), tenure (years active), and 10Y annualized performance.' where key = 'hedge_fund_institutional_strength';
update public.formulas set display_formula = '0.50×(1−etf_pct) + 0.30×(1−option_pct) − 0.20×put_pct', description = 'Preference for active equity; lower ETF, option, and put allocation scores higher.' where key = 'hedge_fund_positioning';
update public.formulas set display_formula = '0.30×performance + 0.25×risk + 0.20×precision + 0.15×institutional + 0.10×positioning', description = 'Composite quality score combining performance, risk, precision, institutional strength, and positioning (each sub-score normalized 0–100).' where key = 'hedge_fund_quality_score';
