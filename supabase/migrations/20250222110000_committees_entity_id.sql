BEGIN;

ALTER TABLE public.committees
  ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_committees_entity_id ON public.committees (entity_id);

COMMENT ON COLUMN public.committees.entity_id IS 'Links to entities table for entity_type=committee (key=system_code)';

COMMIT;
