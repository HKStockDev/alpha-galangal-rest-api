-- Per-member LLM conversations: org-global (no client) or scoped to an organization_client.
-- RLS: only the owning user (active org member) can read/write their conversations and messages.

BEGIN;

-- ============================================================
-- ENUM: message role (OpenAI-style)
-- ============================================================

DO $$
BEGIN
  CREATE TYPE public.llm_chat_message_role AS ENUM (
    'system',
    'user',
    'assistant',
    'tool'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- organization_clients: composite UNIQUE for FK (client belongs to org)
-- ============================================================

DO $$
BEGIN
  ALTER TABLE public.organization_clients
    ADD CONSTRAINT organization_clients_organization_id_id_key
    UNIQUE (organization_id, id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- organization_llm_conversations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_llm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_client_id uuid NULL,
  title text NULL,
  model_key text NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_organization_llm_conversations_client_same_org
    FOREIGN KEY (organization_id, organization_client_id)
    REFERENCES public.organization_clients (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_org_llm_conversations_org_user_updated
  ON public.organization_llm_conversations (organization_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_llm_conversations_org_user_client
  ON public.organization_llm_conversations (organization_id, user_id, organization_client_id);

DROP TRIGGER IF EXISTS trg_organization_llm_conversations_set_updated_at
  ON public.organization_llm_conversations;
CREATE TRIGGER trg_organization_llm_conversations_set_updated_at
  BEFORE UPDATE ON public.organization_llm_conversations
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.organization_llm_conversations IS
  'LLM chat threads per org member. organization_client_id NULL = org-global chat; set = client-specific.';

-- ============================================================
-- organization_llm_messages
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_llm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.organization_llm_conversations(id) ON DELETE CASCADE,
  role public.llm_chat_message_role NOT NULL,
  content text NOT NULL DEFAULT '',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_llm_messages_conversation_created
  ON public.organization_llm_messages (conversation_id, created_at);

-- ============================================================
-- RLS (authenticated + JWT; API service role bypasses)
-- ============================================================

ALTER TABLE public.organization_llm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_llm_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_llm_conversations_select_own ON public.organization_llm_conversations;
CREATE POLICY organization_llm_conversations_select_own
  ON public.organization_llm_conversations
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_llm_conversations.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_llm_conversations_insert_own ON public.organization_llm_conversations;
CREATE POLICY organization_llm_conversations_insert_own
  ON public.organization_llm_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_llm_conversations.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_llm_conversations_update_own ON public.organization_llm_conversations;
CREATE POLICY organization_llm_conversations_update_own
  ON public.organization_llm_conversations
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_llm_conversations.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_llm_conversations.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_llm_conversations_delete_own ON public.organization_llm_conversations;
CREATE POLICY organization_llm_conversations_delete_own
  ON public.organization_llm_conversations
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = organization_llm_conversations.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_llm_messages_select_own ON public.organization_llm_messages;
CREATE POLICY organization_llm_messages_select_own
  ON public.organization_llm_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_llm_conversations c
      WHERE c.id = organization_llm_messages.conversation_id
        AND c.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = c.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  );

DROP POLICY IF EXISTS organization_llm_messages_insert_own ON public.organization_llm_messages;
CREATE POLICY organization_llm_messages_insert_own
  ON public.organization_llm_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_llm_conversations c
      WHERE c.id = organization_llm_messages.conversation_id
        AND c.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = c.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  );

DROP POLICY IF EXISTS organization_llm_messages_update_own ON public.organization_llm_messages;
CREATE POLICY organization_llm_messages_update_own
  ON public.organization_llm_messages
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_llm_conversations c
      WHERE c.id = organization_llm_messages.conversation_id
        AND c.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = c.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_llm_conversations c
      WHERE c.id = organization_llm_messages.conversation_id
        AND c.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = c.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  );

DROP POLICY IF EXISTS organization_llm_messages_delete_own ON public.organization_llm_messages;
CREATE POLICY organization_llm_messages_delete_own
  ON public.organization_llm_messages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_llm_conversations c
      WHERE c.id = organization_llm_messages.conversation_id
        AND c.user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships om
          WHERE om.organization_id = c.organization_id
            AND om.user_id = auth.uid()
            AND om.status = 'active'
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_llm_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_llm_messages TO authenticated;

COMMIT;
