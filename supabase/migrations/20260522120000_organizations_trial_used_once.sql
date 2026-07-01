-- CON-168: one free trial per organization (lifetime).
-- trial_used_at is set when trial Checkout completes (webhook) and backfilled from historical rows.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_used_at timestamptz;

COMMENT ON COLUMN public.organizations.trial_used_at IS
  'When this organization consumed its one lifetime free trial (Stripe Checkout with start_trial).';

UPDATE public.organizations o
SET trial_used_at = sub.first_trial_at
FROM (
  SELECT
    organization_id,
    MIN(COALESCE(trial_end, created_at)) AS first_trial_at
  FROM public.organization_subscriptions
  WHERE trial_end IS NOT NULL
  GROUP BY organization_id
) sub
WHERE o.id = sub.organization_id
  AND o.trial_used_at IS NULL;

COMMIT;
