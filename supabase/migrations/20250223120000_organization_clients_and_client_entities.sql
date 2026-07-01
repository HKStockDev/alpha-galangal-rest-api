-- Organization clients (household/business) and sub-entities with advisor/LLM profile fields.

BEGIN;

-- ============================================================
-- ENUM TYPES
-- ============================================================

DO $$
BEGIN
  CREATE TYPE public.client_type AS ENUM ('family_individual', 'business');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.client_entity_relationship_role AS ENUM (
    'primary_client',
    'spouse_partner',
    'dependent_child',
    'trust_entity',
    'business_plan',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.client_entity_time_horizon AS ENUM (
    'short_term',
    'medium_term',
    'long_term'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.client_entity_liquidity_needs AS ENUM (
    'none_low',
    'moderate',
    'high'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.investment_objective AS ENUM (
    'growth_capital_appreciation',
    'income_yield_generation',
    'preservation_of_capital',
    'retirement_income',
    'education_funding',
    'legacy_estate_planning',
    'business_succession_corporate_reserves'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.tax_account_type AS ENUM (
    'taxable_brokerage',
    'tax_deferred_ira_401k',
    'tax_free_roth',
    'trust_revocable_irrevocable',
    'business_entity_account',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.special_preference_tag AS ENUM (
    'esg_sustainable_impact',
    'avoid_certain_sectors',
    'dividend_focus',
    'low_volatility_low_beta',
    'high_growth_tech_heavy',
    'international_exposure_limit',
    'no_alternatives_illiquids'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- organization_clients
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_type public.client_type NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organization_clients_organization_id
  ON public.organization_clients(organization_id);

DROP TRIGGER IF EXISTS trg_organization_clients_set_updated_at ON public.organization_clients;
CREATE TRIGGER trg_organization_clients_set_updated_at
  BEFORE UPDATE ON public.organization_clients
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

-- ============================================================
-- client_entities
-- ============================================================

CREATE TABLE IF NOT EXISTS public.client_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.organization_clients(id) ON DELETE CASCADE,

  display_name text NOT NULL,

  relationship_role public.client_entity_relationship_role NULL,
  relationship_role_other text NULL,

  risk_score smallint NULL,
  risk_notes text NULL,

  time_horizon_category public.client_entity_time_horizon NULL,
  time_horizon_detail text NULL,

  investment_objectives public.investment_objective[] NOT NULL DEFAULT '{}'::public.investment_objective[],
  investment_objectives_notes text NULL,

  liquidity_needs public.client_entity_liquidity_needs NULL,
  liquidity_notes text NULL,

  tax_account_types public.tax_account_type[] NOT NULL DEFAULT '{}'::public.tax_account_type[],
  tax_account_notes text NULL,

  special_preferences_tags public.special_preference_tag[] NOT NULL DEFAULT '{}'::public.special_preference_tag[],
  special_preferences_notes text NULL,

  age smallint NULL,
  life_stage text NULL,

  notes text NULL,

  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order int NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_client_entities_risk_score
    CHECK (risk_score IS NULL OR (risk_score >= 1 AND risk_score <= 10)),
  CONSTRAINT chk_client_entities_age
    CHECK (age IS NULL OR (age >= 0 AND age <= 130))
);

CREATE INDEX IF NOT EXISTS idx_client_entities_client_id
  ON public.client_entities(client_id);

CREATE INDEX IF NOT EXISTS idx_client_entities_client_display_order
  ON public.client_entities(client_id, display_order NULLS LAST);

DROP TRIGGER IF EXISTS trg_client_entities_set_updated_at ON public.client_entities;
CREATE TRIGGER trg_client_entities_set_updated_at
  BEFORE UPDATE ON public.client_entities
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMIT;
