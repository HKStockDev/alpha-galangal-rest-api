BEGIN;

CREATE TABLE public.social_publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  http_status integer,
  provider_request_id text,
  idempotency_key text,
  external_post_id text,
  error_code text,
  error_message text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (social_post_id, attempt_number)
);

CREATE INDEX idx_social_publish_attempts_post_created
  ON public.social_publish_attempts (social_post_id, created_at DESC);
CREATE INDEX idx_social_publish_attempts_status
  ON public.social_publish_attempts (status, created_at DESC);

COMMIT;
