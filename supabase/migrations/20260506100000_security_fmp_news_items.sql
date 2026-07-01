-- Cached FMP headlines (v3 stock_news) and press releases (v3 press-releases/{symbol})
-- per security. Deduplicated by (security_id, content_hash). Application refreshes via
-- POST /fmp/securities/:securityId/news/ingest (platform admin).

CREATE TABLE IF NOT EXISTS public.security_fmp_news_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  security_id uuid NOT NULL REFERENCES public.securities (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('stock_news', 'press_release')),

  published_at timestamptz,
  title text NOT NULL,
  body text,
  url text,
  site_name text,

  content_hash text NOT NULL,

  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT security_fmp_news_items_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT security_fmp_news_items_content_hash_len CHECK (char_length(content_hash) = 64),
  UNIQUE (security_id, content_hash)
);

CREATE INDEX IF NOT EXISTS security_fmp_news_items_security_channel_published_idx
  ON public.security_fmp_news_items (security_id, channel, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS security_fmp_news_items_security_fetched_idx
  ON public.security_fmp_news_items (security_id, fetched_at DESC);

CREATE OR REPLACE FUNCTION public.security_fmp_news_items_before_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_security_fmp_news_items_before_row ON public.security_fmp_news_items;
CREATE TRIGGER trg_security_fmp_news_items_before_row
  BEFORE INSERT OR UPDATE ON public.security_fmp_news_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.security_fmp_news_items_before_row();

COMMENT ON TABLE public.security_fmp_news_items IS
  'FMP stock_news and press-releases snapshots per security; upserted on admin ingest. '
  'content_hash dedupes re-fetches.';
