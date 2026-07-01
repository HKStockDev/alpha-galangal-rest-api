-- Member-owned security watchlists: org-global or per organization_client; optional provenance from LLM chat.

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_client_id uuid NULL,
  source_organization_llm_conversation_id uuid NULL
    REFERENCES public.organization_llm_conversations(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NULL,
  sort_order int NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_organization_watchlists_client_same_org
    FOREIGN KEY (organization_id, organization_client_id)
    REFERENCES public.organization_clients (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_org_watchlists_org_user_updated
  ON public.organization_watchlists (organization_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_watchlists_org_user_client
  ON public.organization_watchlists (organization_id, user_id, organization_client_id);

CREATE INDEX IF NOT EXISTS idx_org_watchlists_source_conversation
  ON public.organization_watchlists (source_organization_llm_conversation_id)
  WHERE source_organization_llm_conversation_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_organization_watchlists_set_updated_at
  ON public.organization_watchlists;
CREATE TRIGGER trg_organization_watchlists_set_updated_at
  BEFORE UPDATE ON public.organization_watchlists
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.organization_watchlists IS
  'Per-member security lists. organization_client_id NULL = global; set = client-scoped. source_organization_llm_conversation_id links to generating chat if any.';

CREATE TABLE IF NOT EXISTS public.organization_watchlist_securities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES public.organization_watchlists(id) ON DELETE CASCADE,
  security_id uuid NOT NULL REFERENCES public.securities(id) ON DELETE CASCADE,
  sort_order int NULL,
  note text NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_watchlist_securities_watchlist_security_uq
    UNIQUE (watchlist_id, security_id)
);

CREATE INDEX IF NOT EXISTS idx_org_watchlist_securities_watchlist
  ON public.organization_watchlist_securities (watchlist_id, sort_order NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_org_watchlist_securities_security
  ON public.organization_watchlist_securities (security_id);

ALTER TABLE public.organization_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_watchlist_securities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_watchlists_select_own ON public.organization_watchlists;
CREATE POLICY organization_watchlists_select_own
  ON public.organization_watchlists
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_watchlists.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_watchlists_insert_own ON public.organization_watchlists;
CREATE POLICY organization_watchlists_insert_own
  ON public.organization_watchlists
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_watchlists.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_watchlists_update_own ON public.organization_watchlists;
CREATE POLICY organization_watchlists_update_own
  ON public.organization_watchlists
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_watchlists.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_watchlists.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_watchlists_delete_own ON public.organization_watchlists;
CREATE POLICY organization_watchlists_delete_own
  ON public.organization_watchlists
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_watchlists.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_watchlist_securities_select_own ON public.organization_watchlist_securities;
CREATE POLICY organization_watchlist_securities_select_own
  ON public.organization_watchlist_securities
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_watchlists w
      WHERE w.id = organization_watchlist_securities.watchlist_id
        AND w.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = w.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  );

DROP POLICY IF EXISTS organization_watchlist_securities_insert_own ON public.organization_watchlist_securities;
CREATE POLICY organization_watchlist_securities_insert_own
  ON public.organization_watchlist_securities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_watchlists w
      WHERE w.id = organization_watchlist_securities.watchlist_id
        AND w.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = w.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  );

DROP POLICY IF EXISTS organization_watchlist_securities_update_own ON public.organization_watchlist_securities;
CREATE POLICY organization_watchlist_securities_update_own
  ON public.organization_watchlist_securities
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_watchlists w
      WHERE w.id = organization_watchlist_securities.watchlist_id
        AND w.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = w.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_watchlists w
      WHERE w.id = organization_watchlist_securities.watchlist_id
        AND w.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = w.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  );

DROP POLICY IF EXISTS organization_watchlist_securities_delete_own ON public.organization_watchlist_securities;
CREATE POLICY organization_watchlist_securities_delete_own
  ON public.organization_watchlist_securities
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_watchlists w
      WHERE w.id = organization_watchlist_securities.watchlist_id
        AND w.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = w.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_watchlists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_watchlist_securities TO authenticated;

COMMIT;
