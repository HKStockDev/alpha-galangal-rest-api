-- Make securities own the link to entities (consistent with hedge_funds.entity_id)

ALTER TABLE public.securities
  ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL;

UPDATE public.securities s
SET entity_id = e.id
FROM public.entities e
WHERE e.security_id = s.id;

CREATE UNIQUE INDEX IF NOT EXISTS securities_entity_id_uq
  ON public.securities (entity_id)
  WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS securities_entity_id_idx ON public.securities (entity_id);

DROP INDEX IF EXISTS public.entities_security_id_uq;
DROP INDEX IF EXISTS public.entities_security_id_idx;
ALTER TABLE public.entities DROP COLUMN IF EXISTS security_id;
