-- 20260506151000_factors_backfill_public_system_factors.sql
-- Migration 2: backfill system/public vs hidden factors.

BEGIN;

-- Keep baseline as system+hidden unless explicitly promoted.
UPDATE public.factors
SET
  factor_origin = 'system',
  factor_visibility_mode = 'hidden'
WHERE factor_origin IS NULL
   OR factor_visibility_mode IS NULL;

-- Promote widely-safe reusable factors to public.
-- Extend this list as needed for your product.
UPDATE public.factors
SET factor_visibility_mode = 'public'
WHERE key IN (
  'pe_ratio',
  'pb_ratio',
  'ps_ratio',
  'market_cap',
  'enterprise_value',
  'ev_ebitda',
  'ev_revenue',
  'dividend_yield',
  'revenue_growth',
  'eps_growth',
  'roe',
  'roa',
  'roic',
  'gross_margin',
  'operating_margin',
  'net_margin',
  'debt_to_equity',
  'current_ratio',
  'quick_ratio',
  'fcf_yield'
);

-- Optional: if org-owned factors were already created with creator ownership set,
-- classify them as organization-owned.
UPDATE public.factors
SET
  factor_origin = 'organization',
  factor_visibility_mode = COALESCE(NULLIF(factor_visibility_mode, 'hidden'), 'organization')
WHERE organization_id IS NOT NULL
  AND created_by_user_id IS NOT NULL
  AND factor_origin = 'system';

COMMIT;
