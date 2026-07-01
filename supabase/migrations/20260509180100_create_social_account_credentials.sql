BEGIN;

CREATE TABLE public.social_account_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id uuid NOT NULL UNIQUE REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  token_type text NOT NULL DEFAULT 'oauth2',
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  last_refreshed_at timestamptz,
  last_refresh_error_at timestamptz,
  last_refresh_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_social_account_credentials_set_updated_at
BEFORE UPDATE ON public.social_account_credentials
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_social_account_credentials_expires_at
  ON public.social_account_credentials (token_expires_at);

COMMIT;
