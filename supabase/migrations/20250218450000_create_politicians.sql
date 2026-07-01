BEGIN;

CREATE TABLE IF NOT EXISTS public.politicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE RESTRICT,

  name text NOT NULL,
  bioguide_id text,
  chamber text,
  party text,
  state text,
  role text,

  is_current boolean NOT NULL DEFAULT true,

  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT politicians_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_politicians_bioguide_id
  ON public.politicians(bioguide_id)
  WHERE bioguide_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_politicians_entity_id
  ON public.politicians(entity_id);

CREATE INDEX IF NOT EXISTS ix_politicians_is_current
  ON public.politicians(is_current);

CREATE INDEX IF NOT EXISTS ix_politicians_chamber
  ON public.politicians(chamber);

COMMIT;
