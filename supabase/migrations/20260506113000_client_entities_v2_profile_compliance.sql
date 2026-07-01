-- Expand client_entities with legal/compliance/lifecycle/relationship fields.

BEGIN;

-- ============================================================
-- ENUM TYPES
-- ============================================================

DO $$
BEGIN
  CREATE TYPE public.client_entity_type AS ENUM (
    'individual',
    'company',
    'trust',
    'joint',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.client_kyc_status AS ENUM (
    'not_started',
    'pending',
    'verified',
    'rejected',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.client_onboarding_status AS ENUM (
    'draft',
    'in_progress',
    'completed',
    'blocked'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.client_status AS ENUM (
    'active',
    'inactive',
    'suspended',
    'closed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.client_aml_risk_level AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- client_entities expansion
-- ============================================================

ALTER TABLE public.client_entities
  ADD COLUMN IF NOT EXISTS entity_type public.client_entity_type NULL,
  ADD COLUMN IF NOT EXISTS legal_name text NULL,
  ADD COLUMN IF NOT EXISTS date_of_birth date NULL,
  ADD COLUMN IF NOT EXISTS incorporation_date date NULL,

  ADD COLUMN IF NOT EXISTS tax_id text NULL,
  ADD COLUMN IF NOT EXISTS national_id text NULL,
  ADD COLUMN IF NOT EXISTS passport_no text NULL,

  ADD COLUMN IF NOT EXISTS country_of_residence text NULL,
  ADD COLUMN IF NOT EXISTS country_of_incorporation text NULL,
  ADD COLUMN IF NOT EXISTS tax_residency text NULL,

  ADD COLUMN IF NOT EXISTS kyc_status public.client_kyc_status NULL,
  ADD COLUMN IF NOT EXISTS kyc_verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS aml_risk_level public.client_aml_risk_level NULL,
  ADD COLUMN IF NOT EXISTS pep_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sanctions_flag boolean NOT NULL DEFAULT false,

  ADD COLUMN IF NOT EXISTS parent_entity_id uuid NULL,
  ADD COLUMN IF NOT EXISTS beneficial_owner_of uuid NULL,
  ADD COLUMN IF NOT EXISTS ownership_percent numeric(5,2) NULL,

  ADD COLUMN IF NOT EXISTS onboarding_status public.client_onboarding_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS client_status public.client_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS closure_reason text NULL,

  ADD COLUMN IF NOT EXISTS source_system text NULL,
  ADD COLUMN IF NOT EXISTS source_system_id text NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL,
  ADD COLUMN IF NOT EXISTS version int4 NOT NULL DEFAULT 1;

-- Self-referencing relationship graph FKs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_entities_parent_entity_id_fkey'
  ) THEN
    ALTER TABLE public.client_entities
      ADD CONSTRAINT client_entities_parent_entity_id_fkey
      FOREIGN KEY (parent_entity_id)
      REFERENCES public.client_entities(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_entities_beneficial_owner_of_fkey'
  ) THEN
    ALTER TABLE public.client_entities
      ADD CONSTRAINT client_entities_beneficial_owner_of_fkey
      FOREIGN KEY (beneficial_owner_of)
      REFERENCES public.client_entities(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Data-quality constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_client_entities_ownership_percent'
  ) THEN
    ALTER TABLE public.client_entities
      ADD CONSTRAINT chk_client_entities_ownership_percent
      CHECK (
        ownership_percent IS NULL OR
        (ownership_percent >= 0 AND ownership_percent <= 100)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_client_entities_closed_fields'
  ) THEN
    ALTER TABLE public.client_entities
      ADD CONSTRAINT chk_client_entities_closed_fields
      CHECK (
        client_status <> 'closed'
        OR closed_at IS NOT NULL
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_client_entities_entity_type_dates'
  ) THEN
    ALTER TABLE public.client_entities
      ADD CONSTRAINT chk_client_entities_entity_type_dates
      CHECK (
        (entity_type = 'individual' AND incorporation_date IS NULL)
        OR (entity_type IS DISTINCT FROM 'individual')
      );
  END IF;
END $$;

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_client_entities_entity_type
  ON public.client_entities(entity_type);

CREATE INDEX IF NOT EXISTS idx_client_entities_kyc_status
  ON public.client_entities(kyc_status);

CREATE INDEX IF NOT EXISTS idx_client_entities_client_status
  ON public.client_entities(client_status);

CREATE INDEX IF NOT EXISTS idx_client_entities_parent_entity_id
  ON public.client_entities(parent_entity_id);

CREATE INDEX IF NOT EXISTS idx_client_entities_source_system_id
  ON public.client_entities(source_system, source_system_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_entities_source_pair
  ON public.client_entities(source_system, source_system_id)
  WHERE source_system IS NOT NULL
    AND source_system_id IS NOT NULL;

COMMIT;
