-- 20260506160000_add_factor_capabilities_and_plan_entitlement_defaults.sql
-- Adds factor capability keys and seeds default plan entitlements.

BEGIN;

-- 1) Ensure capability registry entries exist
INSERT INTO public.ai_capabilities (
  capability_key,
  display_name,
  description,
  is_mutating,
  default_requires_confirmation
)
VALUES
  ('factor.read', 'Read Factors', 'Read factors available under policy/entitlements', false, false),
  ('factor.create', 'Create Factor', 'Create a new organization-owned factor', true, true),
  ('factor.update', 'Update Factor', 'Update an existing organization-owned factor', true, true)
ON CONFLICT (capability_key) DO NOTHING;

-- 2) Ensure global capability policies exist for newly added keys
INSERT INTO public.ai_capability_policies (
  capability_key,
  is_enabled,
  requires_confirmation,
  policy_mode
)
SELECT c.capability_key, true, c.default_requires_confirmation, 'strict'
FROM public.ai_capabilities c
WHERE c.capability_key IN ('factor.read', 'factor.create', 'factor.update')
ON CONFLICT (capability_key) DO NOTHING;

-- 3) Seed plan entitlements defaults:
--    - factor.read enabled for all active plans
--    - factor.create / factor.update enabled for non-entry plans by plan_key convention
-- Adjust conventions if your plan keys differ.
INSERT INTO public.subscription_plan_entitlements (
  plan_id,
  capability_key,
  is_enabled,
  quota_period,
  quota_limit,
  hard_block,
  upsell_message
)
SELECT
  p.id,
  'factor.read',
  true,
  NULL,
  NULL,
  false,
  NULL
FROM public.subscription_plans p
WHERE p.is_active = true
ON CONFLICT (plan_id, capability_key) DO NOTHING;

INSERT INTO public.subscription_plan_entitlements (
  plan_id,
  capability_key,
  is_enabled,
  quota_period,
  quota_limit,
  hard_block,
  upsell_message
)
SELECT
  p.id,
  'factor.create',
  CASE
    WHEN COALESCE(p.plan_key, '') IN ('starter', 'free', 'basic') THEN false
    ELSE true
  END,
  NULL,
  NULL,
  false,
  CASE
    WHEN COALESCE(p.plan_key, '') IN ('starter', 'free', 'basic')
      THEN 'Upgrade your plan to create custom factors.'
    ELSE NULL
  END
FROM public.subscription_plans p
WHERE p.is_active = true
ON CONFLICT (plan_id, capability_key) DO NOTHING;

INSERT INTO public.subscription_plan_entitlements (
  plan_id,
  capability_key,
  is_enabled,
  quota_period,
  quota_limit,
  hard_block,
  upsell_message
)
SELECT
  p.id,
  'factor.update',
  CASE
    WHEN COALESCE(p.plan_key, '') IN ('starter', 'free', 'basic') THEN false
    ELSE true
  END,
  NULL,
  NULL,
  false,
  CASE
    WHEN COALESCE(p.plan_key, '') IN ('starter', 'free', 'basic')
      THEN 'Upgrade your plan to update custom factors.'
    ELSE NULL
  END
FROM public.subscription_plans p
WHERE p.is_active = true
ON CONFLICT (plan_id, capability_key) DO NOTHING;

COMMIT;
