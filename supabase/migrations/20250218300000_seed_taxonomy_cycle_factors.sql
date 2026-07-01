BEGIN;

ALTER TABLE public.factors DROP CONSTRAINT IF EXISTS chk_factors_data_grain;
ALTER TABLE public.factors ADD CONSTRAINT chk_factors_data_grain
  CHECK (data_grain IN ('snapshot', 'time_series', 'sector', 'industry', 'sub_industry'));

ALTER TABLE public.factors DROP CONSTRAINT IF EXISTS chk_factors_period_supported;
ALTER TABLE public.factors ADD CONSTRAINT chk_factors_period_supported
  CHECK (period_supported IN ('quarterly', 'annual', 'both', 'none', '6,12,24'));

ALTER TABLE public.factors DROP CONSTRAINT IF EXISTS chk_factors_statement_type;
ALTER TABLE public.factors ADD CONSTRAINT chk_factors_statement_type
  CHECK (statement_type IN (
    'income_statement', 'balance_sheet', 'cash_flow_statement',
    'financial_ratio', 'market_data', 'custom', 'taxonomy_cycle'
  ));

INSERT INTO public.factors (
  id, key, name, value_type, description, created_at, data_grain, period_supported, statement_type
)
VALUES
  (gen_random_uuid(), 'sector_cycle_score', 'Sector Cycle Score', 'numeric',
   'Cycle score for a sector for a given horizon (e.g., 24M).', now(), 'sector', '6,12,24', 'taxonomy_cycle'),
  (gen_random_uuid(), 'industry_cycle_score', 'Industry Cycle Score', 'numeric',
   'Cycle score for an industry for a given horizon (e.g., 12M).', now(), 'industry', '6,12,24', 'taxonomy_cycle'),
  (gen_random_uuid(), 'sub_industry_cycle_score', 'Sub-Industry Cycle Score', 'numeric',
   'Cycle score for a sub-industry for a given horizon (e.g., 6M).', now(), 'sub_industry', '6,12,24', 'taxonomy_cycle')
ON CONFLICT (key) DO UPDATE
SET
  name = EXCLUDED.name,
  value_type = EXCLUDED.value_type,
  description = EXCLUDED.description,
  data_grain = EXCLUDED.data_grain,
  period_supported = EXCLUDED.period_supported,
  statement_type = EXCLUDED.statement_type;

COMMIT;
