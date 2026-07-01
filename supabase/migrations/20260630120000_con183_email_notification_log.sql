-- CON-183: Idempotent transactional email log for billing webhook notifications.

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  stripe_event_id text,
  recipient_email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_notification_log_stripe_event_id
  ON public.email_notification_log(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_notification_log_sent_at
  ON public.email_notification_log(sent_at DESC);

COMMIT;
