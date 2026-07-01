BEGIN;

-- CON-176: hybrid social prompt library (base + overlays + guardrail)
INSERT INTO public.social_prompt_templates (
  template_key,
  channel,
  post_kind,
  purpose,
  prompt_role,
  template_text,
  required_context_keys,
  change_note
) VALUES
  (
    'caption_base_signal_v1',
    'all',
    'all',
    'caption',
    'base',
    $prompt$Write a social post caption for a stock screener signal.

Organization: {{organization_name}}
Ticker: {{ticker}}
Signal: {{signal_name}}
Summary: {{summary}}
Link: {{page_url}}

Requirements:
- Lead with the ticker and signal name.
- One or two sentences of context from the summary; do not invent facts.
- End with the link on its own line.
- No emojis unless the platform overlay allows them.
- Output only the caption text, no quotes or markdown.$prompt$,
    ARRAY['ticker', 'signal_name', 'summary', 'page_url', 'organization_name'],
    'MVP base caption'
  ),
  (
    'overlay_x_short_v1',
    'x',
    'all',
    'caption',
    'platform_overlay',
    $prompt$Platform: X (Twitter).
- Maximum 280 characters total including the link.
- Short, direct tone; at most 2 relevant hashtags (e.g. #stocks #{{ticker}}).
- No thread; single post only.$prompt$,
    ARRAY['ticker'],
    'X overlay'
  ),
  (
    'overlay_linkedin_professional_v1',
    'linkedin',
    'all',
    'caption',
    'platform_overlay',
    $prompt$Platform: LinkedIn.
- Professional, neutral tone suitable for advisors and researchers.
- Up to 3 short paragraphs; link may appear in body and will also be in link preview.
- Avoid slang; no more than 3 hashtags at the end.$prompt$,
    '{}'::text[],
    'LinkedIn overlay'
  ),
  (
    'overlay_facebook_page_v1',
    'facebook',
    'all',
    'caption',
    'platform_overlay',
    $prompt$Platform: Facebook Page.
- Conversational but credible tone.
- 2–4 sentences; encourage readers to click the link for details.
- Minimal hashtags (0–2).$prompt$,
    '{}'::text[],
    'Facebook overlay'
  ),
  (
    'overlay_link_share_v1',
    'all',
    'link_share',
    'caption',
    'post_kind_overlay',
    $prompt$Post type: link share.
- The URL {{page_url}} must appear verbatim in the caption.
- First line should state what the reader will find at the link.$prompt$,
    ARRAY['page_url'],
    'link_share overlay'
  ),
  (
    'guardrail_financial_v1',
    'all',
    'all',
    'caption',
    'guardrail',
    $prompt$Compliance rules (always apply):
- Do not provide personalized financial advice or buy/sell recommendations.
- Do not promise returns or imply guaranteed outcomes.
- Do not claim the signal is a sure win.
- Append this disclaimer as the final line: "Not investment advice. Do your own research."$prompt$,
    '{}'::text[],
    'financial guardrail'
  )
ON CONFLICT (template_key) DO NOTHING;

-- CON-108: MVP render template for signal shares
INSERT INTO public.social_render_templates (
  template_key,
  display_name,
  description,
  renderer,
  layout_version,
  compatible_post_kinds,
  default_prompt_bundle
) VALUES (
  'signal_card_v1',
  'Signal share card',
  '1200x630 OG-style card for formula/signal shares. Layout implemented in app code (code_registry_v1).',
  'code_registry_v1',
  1,
  ARRAY['single_image', 'link_share']::text[],
  jsonb_build_object(
    'caption_base', 'caption_base_signal_v1',
    'guardrail', 'guardrail_financial_v1',
    'post_kind_overlay', 'overlay_link_share_v1',
    'platform_overlay', jsonb_build_object(
      'x', 'overlay_x_short_v1',
      'linkedin', 'overlay_linkedin_professional_v1',
      'facebook', 'overlay_facebook_page_v1'
    )
  )
)
ON CONFLICT (template_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  compatible_post_kinds = EXCLUDED.compatible_post_kinds,
  default_prompt_bundle = EXCLUDED.default_prompt_bundle,
  updated_at = now();

-- Normalized slot links for composer / admin UI
INSERT INTO public.social_render_template_prompts (render_template_key, slot, prompt_template_id, sort_order)
SELECT 'signal_card_v1', v.slot, p.id, v.sort_order
FROM (VALUES
  ('caption_base', 0),
  ('guardrail', 10),
  ('post_kind_overlay', 20),
  ('platform_overlay_x', 30),
  ('platform_overlay_linkedin', 40),
  ('platform_overlay_facebook', 50)
) AS v(slot, sort_order)
JOIN public.social_prompt_templates p ON p.template_key = CASE v.slot
  WHEN 'caption_base' THEN 'caption_base_signal_v1'
  WHEN 'guardrail' THEN 'guardrail_financial_v1'
  WHEN 'post_kind_overlay' THEN 'overlay_link_share_v1'
  WHEN 'platform_overlay_x' THEN 'overlay_x_short_v1'
  WHEN 'platform_overlay_linkedin' THEN 'overlay_linkedin_professional_v1'
  WHEN 'platform_overlay_facebook' THEN 'overlay_facebook_page_v1'
END
ON CONFLICT (render_template_key, slot, sort_order) DO NOTHING;

COMMIT;
