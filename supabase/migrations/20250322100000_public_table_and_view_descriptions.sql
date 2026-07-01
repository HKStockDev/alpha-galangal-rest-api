-- Human-readable descriptions for Supabase Table Editor (pg_catalog.obj_description).

BEGIN;

COMMENT ON TABLE public.client_entities IS
  'People or sub-units within an organization client (household/business): roles, risk, objectives, tax posture, preferences, and advisor notes.';

COMMENT ON TABLE public.committees IS
  'Legislative and oversight committees (e.g. Congress), linked to taxonomy/entities where applicable.';

COMMENT ON TABLE public.entities IS
  'Canonical subjects for scoring and analytics (companies, funds, people, committees, etc.) with type and external keys.';

COMMENT ON TABLE public.entity_factor_values IS
  'Current or point-in-time factor outputs per entity (scores, explanations, model metadata).';

COMMENT ON TABLE public.entity_factor_values_ts IS
  'Time-series history of entity factor values for trend and as-of queries.';

COMMENT ON TABLE public.entity_scores_current IS
  'Latest aggregate scores per entity (rollup of formula/factor pipeline).';

COMMENT ON TABLE public.entity_scores_history IS
  'Historical snapshots of entity scores for auditing and charts.';

COMMENT ON TABLE public.exposures IS
  'Reusable exposure definitions (themes, sectors, macro) used to classify securities.';

COMMENT ON TABLE public.factors IS
  'Configurable inputs and rules for entity scoring; tenant-scoped per organization where set.';

COMMENT ON TABLE public.formula_components IS
  'Links formulas to factors and weights (or nested structure) for composite scoring.';

COMMENT ON TABLE public.formulas IS
  'Named scoring or signal formulas composed of factors; tenant-scoped per organization.';

COMMENT ON TABLE public.hedge_funds IS
  'Hedge fund records aligned with entities and regulatory/list sources.';

COMMENT ON VIEW public.hedge_funds_list IS
  'Read-only denormalized view of hedge funds with list-friendly fields and metrics for browsing.';

COMMENT ON TABLE public.insider_trades IS
  'Reported insider buy/sell transactions tied to securities and insiders.';

COMMENT ON TABLE public.insiders IS
  'Corporate insiders (officers, directors, large holders) for Form 4 and similar filings.';

COMMENT ON TABLE public.organization_clients IS
  'Advisor-facing client records per organization (household or business); parent of client_entities.';

COMMENT ON TABLE public.organization_invitations IS
  'Email-based invites to join an organization with role, token, expiry, and accept/revoke state.';

COMMENT ON TABLE public.organization_llm_conversations IS
  'LLM chat threads per org member; organization_client_id null means org-wide, set means client-scoped.';

COMMENT ON TABLE public.organization_llm_messages IS
  'Messages in an organization LLM conversation (user/assistant/system roles and content).';

COMMENT ON TABLE public.organization_memberships IS
  'Links auth users (profiles) to organizations with role and membership status.';

COMMENT ON TABLE public.organizations IS
  'Multi-tenant organizations (RIA, fund, family office, etc.) with slug, type, and settings.';

COMMENT ON TABLE public.organization_watchlist_securities IS
  'Securities on a member watchlist with optional ordering and notes.';

COMMENT ON TABLE public.organization_watchlists IS
  'Per-member security lists; organization_client_id null = org-global, set = scoped to one client; may reference originating LLM conversation.';

COMMENT ON TABLE public.politician_committee_memberships IS
  'Links politicians to committees with party/side and source-aligned identifiers.';

COMMENT ON TABLE public.politicians IS
  'Elected and appointed officials used for political and committee analytics.';

COMMENT ON TABLE public.politician_terms IS
  'Office terms for politicians (chamber, dates, district) for temporal queries.';

COMMENT ON TABLE public.profiles IS
  'App profile per Supabase auth user: email, display name, status, and login metadata.';

COMMENT ON TABLE public.prompt_versions IS
  'Versioned prompt text and parameters for LLM calls; tied to prompts and optionally tenant-scoped.';

COMMENT ON TABLE public.prompts IS
  'Named prompt definitions (key, category) pointing at versioned content for pipelines and UI.';

COMMENT ON TABLE public.securities IS
  'Tradable instruments (equity, ETF, etc.) with symbols, identifiers, and links to entities.';

COMMENT ON TABLE public.security_classifications IS
  'Labels or buckets assigned to securities (e.g. sector, cap) for filtering and formulas.';

COMMENT ON TABLE public.security_exposures IS
  'Many-to-many link between securities and exposure definitions with optional weights.';

COMMENT ON TABLE public.security_tags IS
  'Associates securities with user- or system-defined tags for grouping and search.';

COMMENT ON TABLE public.signal_categories IS
  'Categories for organizing signals and formulas; tenant-scoped per organization.';

COMMENT ON TABLE public.sic_to_taxonomy_map IS
  'Maps SIC codes to internal taxonomy nodes for industry classification.';

COMMENT ON TABLE public.tags IS
  'Free-form or curated tags for securities and workflows; tenant-scoped per organization.';

COMMENT ON TABLE public.taxonomies IS
  'Taxonomy roots (e.g. industry trees) with metadata for classification.';

COMMENT ON TABLE public.taxonomy_nodes IS
  'Hierarchical nodes within a taxonomy (parent/child, codes, descriptions).';

COMMIT;
