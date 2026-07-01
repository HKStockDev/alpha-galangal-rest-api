-- CON-113: supporting indexes for client-scoped watchlist queries (scope convert / list by client)
-- and duplicate/export read patterns (watchlist_id already indexed on organization_watchlist_securities).

BEGIN;

CREATE INDEX IF NOT EXISTS idx_org_watchlists_org_client_scope
  ON public.organization_watchlists (organization_id, organization_client_id, user_id, updated_at DESC)
  WHERE organization_client_id IS NOT NULL;

COMMENT ON INDEX public.idx_org_watchlists_org_client_scope IS
  'Speeds listing and scope-conversion workflows for client-attached watchlists within an org.';

COMMIT;
