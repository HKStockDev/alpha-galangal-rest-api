BEGIN;

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS taxonomy_node_id uuid REFERENCES public.taxonomy_nodes(node_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_entities_taxonomy_node_id
  ON public.entities(taxonomy_node_id)
  WHERE taxonomy_node_id IS NOT NULL;

INSERT INTO public.entities (entity_type, key, name, taxonomy_node_id)
SELECT
  n.level::text,
  (n.taxonomy_id::text || '_' || COALESCE(n.code, n.node_id::text)),
  COALESCE(n.title, n.code::text, n.node_id::text),
  n.node_id
FROM public.taxonomy_nodes n
WHERE n.level IN ('sector', 'industry', 'sub_industry')
  AND n.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.entities e
    WHERE e.taxonomy_node_id = n.node_id
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
