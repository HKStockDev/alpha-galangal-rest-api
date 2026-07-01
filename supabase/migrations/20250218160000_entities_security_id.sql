ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS security_id uuid REFERENCES public.securities(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entities_security_id_uq
  ON public.entities (security_id)
  WHERE security_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS entities_security_id_idx ON public.entities (security_id);

INSERT INTO public.securities (ticker, market, locale, name, type_code)
SELECT DISTINCT e.key, 'stocks', 'us', coalesce(e.name, e.key), 'CS'
FROM public.entities e
WHERE e.entity_type = 'stock'
  AND NOT EXISTS (
    SELECT 1 FROM public.securities s
    WHERE s.market = 'stocks' AND s.locale = 'us' AND s.ticker = e.key
  );

UPDATE public.entities e
SET security_id = s.id
FROM public.securities s
WHERE e.entity_type = 'stock'
  AND e.security_id IS NULL
  AND s.market = 'stocks'
  AND s.locale = 'us'
  AND s.ticker = e.key;
