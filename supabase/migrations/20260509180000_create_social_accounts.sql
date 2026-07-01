BEGIN;

CREATE TABLE public.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (
    platform IN ('facebook', 'instagram', 'tiktok', 'stocktwits', 'x', 'linkedin')
  ),
  account_label text NOT NULL,
  external_account_id text NOT NULL,
  external_account_name text,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'revoked', 'disconnected', 'error')
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_successful_publish_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, platform, external_account_id)
);

COMMENT ON COLUMN public.social_accounts.platform IS
  'facebook | instagram | tiktok | stocktwits | x | linkedin (matches MVP CSV platforms).';

CREATE TRIGGER trg_social_accounts_set_updated_at
BEFORE UPDATE ON public.social_accounts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_social_accounts_org ON public.social_accounts (organization_id);
CREATE INDEX idx_social_accounts_platform_status ON public.social_accounts (platform, status);

COMMIT;
