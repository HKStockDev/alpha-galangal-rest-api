-- 20260506143000_create_stripe_event_log.sql
-- Idempotent Stripe webhook event log for reliable processing/replay.

BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.stripe_event_log
  DROP CONSTRAINT IF EXISTS stripe_event_log_status_check;
ALTER TABLE public.stripe_event_log
  ADD CONSTRAINT stripe_event_log_status_check
  CHECK (status IN ('pending', 'processed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_stripe_event_log_received_at
  ON public.stripe_event_log(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_event_log_status
  ON public.stripe_event_log(status);

COMMIT;
