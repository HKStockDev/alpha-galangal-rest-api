-- Audit who last changed plan entitlements (CON-160 phase 6).

BEGIN;

ALTER TABLE public.subscription_plan_entitlements
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid NULL;

ALTER TABLE public.subscription_plan_entitlements
  DROP CONSTRAINT IF EXISTS subscription_plan_entitlements_updated_by_user_id_fkey;

ALTER TABLE public.subscription_plan_entitlements
  ADD CONSTRAINT subscription_plan_entitlements_updated_by_user_id_fkey
    FOREIGN KEY (updated_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMIT;
