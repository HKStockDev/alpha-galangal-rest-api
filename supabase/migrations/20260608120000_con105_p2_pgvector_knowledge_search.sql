-- CON-105 Phase 2: pgvector knowledge chunks + hybrid semantic search RPC.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.organization_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  organization_client_id uuid NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  title text NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding vector(768) NULL,
  embedded_at timestamptz NULL,
  source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_organization_knowledge_chunks_source_type
    CHECK (source_type IN ('client_entity_risk_notes', 'formula_release_body', 'chat_message')),
  CONSTRAINT chk_organization_knowledge_chunks_content_nonempty
    CHECK (btrim(content) <> ''),
  CONSTRAINT uq_organization_knowledge_chunks_source_hash
    UNIQUE (source_type, source_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_org_knowledge_chunks_org_client
  ON public.organization_knowledge_chunks (organization_id, organization_client_id);

CREATE INDEX IF NOT EXISTS idx_org_knowledge_chunks_source
  ON public.organization_knowledge_chunks (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_org_knowledge_chunks_embedding_hnsw
  ON public.organization_knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE public.organization_knowledge_chunks IS
  'Org-scoped semantic search chunks (client risk notes, release bodies, chat snippets).';

DROP TRIGGER IF EXISTS trg_organization_knowledge_chunks_set_updated_at
  ON public.organization_knowledge_chunks;
CREATE TRIGGER trg_organization_knowledge_chunks_set_updated_at
  BEFORE UPDATE ON public.organization_knowledge_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.organization_knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.search_organization_knowledge(
  p_organization_id uuid,
  p_organization_client_id uuid,
  p_query_embedding vector(768),
  p_source_types text[] DEFAULT NULL,
  p_match_count integer DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  source_type text,
  source_id uuid,
  organization_client_id uuid,
  title text,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    k.id,
    k.source_type,
    k.source_id,
    k.organization_client_id,
    k.title,
    k.content,
    (1 - (k.embedding <=> p_query_embedding))::double precision AS similarity
  FROM public.organization_knowledge_chunks k
  WHERE k.organization_id = p_organization_id
    AND k.embedding IS NOT NULL
    AND (
      p_organization_client_id IS NULL
      OR k.organization_client_id IS NULL
      OR k.organization_client_id = p_organization_client_id
    )
    AND (
      p_source_types IS NULL
      OR cardinality(p_source_types) = 0
      OR k.source_type = ANY (p_source_types)
    )
  ORDER BY k.embedding <=> p_query_embedding
  LIMIT GREATEST(1, LEAST(COALESCE(p_match_count, 8), 20));
$$;

COMMENT ON FUNCTION public.search_organization_knowledge IS
  'Hybrid org filter + pgvector cosine top-k for assistant knowledge search.';

INSERT INTO public.ai_capabilities (capability_key, display_name, description, is_mutating, default_requires_confirmation)
VALUES
  ('knowledge.search', 'Knowledge Search', 'Semantic search over org knowledge chunks', false, false)
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO public.ai_capability_policies (capability_key, is_enabled, requires_confirmation, policy_mode)
SELECT capability_key, true, default_requires_confirmation, 'strict'
FROM public.ai_capabilities
WHERE capability_key = 'knowledge.search'
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO public.ai_tools (
  tool_key, capability_key, display_name, description, input_schema_json, output_schema_json, timeout_ms, rate_limit_per_minute
)
VALUES
  (
    'tool.knowledge.search',
    'knowledge.search',
    'Knowledge Search',
    'Semantic search over client risk notes, formula release bodies, and chat history',
    '{
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Natural language search query" },
        "source_types": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["client_entity_risk_notes", "formula_release_body", "chat_message"]
          },
          "description": "Optional source filters"
        },
        "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 8 }
      },
      "required": ["query"]
    }'::jsonb,
    '{"type": "object"}'::jsonb,
    15000,
    60
  )
ON CONFLICT (tool_key) DO UPDATE SET
  capability_key = EXCLUDED.capability_key,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  input_schema_json = EXCLUDED.input_schema_json,
  output_schema_json = EXCLUDED.output_schema_json,
  timeout_ms = EXCLUDED.timeout_ms,
  rate_limit_per_minute = EXCLUDED.rate_limit_per_minute;

INSERT INTO public.subscription_plan_entitlements (
  plan_id, capability_key, is_enabled, quota_period, quota_limit, hard_block, upsell_message
)
SELECT p.id, 'knowledge.search', true, NULL, NULL, false, NULL
FROM public.subscription_plans p
WHERE p.is_active = true
ON CONFLICT (plan_id, capability_key) DO NOTHING;

INSERT INTO public.ai_capability_credit_costs (capability_key, credits_cost, is_enabled)
VALUES ('knowledge.search', 0, true)
ON CONFLICT (capability_key) DO NOTHING;

UPDATE public.ai_prompt_templates
SET template_text = template_text || E'\n\nUse tool.knowledge.search for semantic lookups across client risk notes, published formula releases, and prior chat messages when keyword tools are insufficient.',
    change_note = COALESCE(change_note, '') || ' CON-105-P2 knowledge search'
WHERE template_key = 'system_prompt_tools'
  AND template_text NOT ILIKE '%tool.knowledge.search%';

COMMIT;
