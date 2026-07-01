BEGIN;

-- Hook-first base for short-form render scripts
INSERT INTO public.social_prompt_templates (
  template_key,
  channel,
  post_kind,
  purpose,
  prompt_role,
  template_text,
  required_context_keys,
  change_note
) VALUES (
  'caption_base_hook_v1',
  'all',
  'all',
  'caption',
  'base',
  $prompt$Write a punchy social post hook for a stock screener signal.

Organization: {{organization_name}}
Ticker: {{ticker}}
Signal: {{signal_name}}
Summary: {{summary}}
Link: {{page_url}}

Requirements:
- Open with a bold hook (question, stat, or contrast) in the first line.
- One follow-up sentence max from the summary; no invented facts.
- Include {{page_url}} on its own final line.
- Output only caption text, no quotes or markdown.$prompt$,
  ARRAY['ticker', 'signal_name', 'summary', 'page_url', 'organization_name'],
  'hook-first base for quick_take_v1'
)
ON CONFLICT (template_key) DO NOTHING;

-- Expand signal_card_v1 platform overlays
UPDATE public.social_render_templates
SET default_prompt_bundle = jsonb_set(
  jsonb_set(
    jsonb_set(
      default_prompt_bundle,
      '{platform_overlay,instagram}',
      '"overlay_instagram_caption_v1"'::jsonb,
      true
    ),
    '{platform_overlay,tiktok}',
    '"overlay_tiktok_short_v1"'::jsonb,
    true
  ),
  '{platform_overlay,stocktwits}',
  '"overlay_stocktwits_v1"'::jsonb,
  true
),
updated_at = now()
WHERE template_key = 'signal_card_v1';

INSERT INTO public.social_render_template_prompts (render_template_key, slot, prompt_template_id, sort_order)
SELECT 'signal_card_v1', v.slot, p.id, v.sort_order
FROM (VALUES
  ('platform_overlay_instagram', 60),
  ('platform_overlay_tiktok', 70),
  ('platform_overlay_stocktwits', 80)
) AS v(slot, sort_order)
JOIN public.social_prompt_templates p ON p.template_key = CASE v.slot
  WHEN 'platform_overlay_instagram' THEN 'overlay_instagram_caption_v1'
  WHEN 'platform_overlay_tiktok' THEN 'overlay_tiktok_short_v1'
  WHEN 'platform_overlay_stocktwits' THEN 'overlay_stocktwits_v1'
END
ON CONFLICT (render_template_key, slot, sort_order) DO NOTHING;

-- quick_take_v1
INSERT INTO public.social_render_templates (
  template_key,
  display_name,
  description,
  renderer,
  layout_version,
  compatible_post_kinds,
  default_prompt_bundle
) VALUES (
  'quick_take_v1',
  'Quick take',
  'Short hook-first captions for X, TikTok, and StockTwits. Best for fast signal drops and link shares.',
  'code_registry_v1',
  1,
  ARRAY['text', 'link_share']::text[],
  jsonb_build_object(
    'caption_base', 'caption_base_hook_v1',
    'guardrail', 'guardrail_financial_v1',
    'post_kind_overlay', 'overlay_link_share_v1',
    'platform_overlay', jsonb_build_object(
      'x', 'overlay_x_short_v1',
      'tiktok', 'overlay_tiktok_short_v1',
      'stocktwits', 'overlay_stocktwits_v1'
    )
  )
)
ON CONFLICT (template_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  compatible_post_kinds = EXCLUDED.compatible_post_kinds,
  default_prompt_bundle = EXCLUDED.default_prompt_bundle,
  updated_at = now();

INSERT INTO public.social_render_template_prompts (render_template_key, slot, prompt_template_id, sort_order)
SELECT 'quick_take_v1', v.slot, p.id, v.sort_order
FROM (VALUES
  ('caption_base', 0),
  ('guardrail', 10),
  ('post_kind_overlay', 20),
  ('platform_overlay_x', 30),
  ('platform_overlay_tiktok', 40),
  ('platform_overlay_stocktwits', 50)
) AS v(slot, sort_order)
JOIN public.social_prompt_templates p ON p.template_key = CASE v.slot
  WHEN 'caption_base' THEN 'caption_base_hook_v1'
  WHEN 'guardrail' THEN 'guardrail_financial_v1'
  WHEN 'post_kind_overlay' THEN 'overlay_link_share_v1'
  WHEN 'platform_overlay_x' THEN 'overlay_x_short_v1'
  WHEN 'platform_overlay_tiktok' THEN 'overlay_tiktok_short_v1'
  WHEN 'platform_overlay_stocktwits' THEN 'overlay_stocktwits_v1'
END
ON CONFLICT (render_template_key, slot, sort_order) DO NOTHING;

-- image_first_v1
INSERT INTO public.social_render_templates (
  template_key,
  display_name,
  description,
  renderer,
  layout_version,
  compatible_post_kinds,
  default_prompt_bundle
) VALUES (
  'image_first_v1',
  'Image-first post',
  'Visual-first captions when the card or image carries the story. Instagram, Facebook, and LinkedIn.',
  'code_registry_v1',
  1,
  ARRAY['single_image', 'link_share']::text[],
  jsonb_build_object(
    'caption_base', 'caption_base_signal_v1',
    'guardrail', 'guardrail_financial_v1',
    'post_kind_overlay', 'overlay_single_image_v1',
    'platform_overlay', jsonb_build_object(
      'instagram', 'overlay_instagram_caption_v1',
      'facebook', 'overlay_facebook_page_v1',
      'linkedin', 'overlay_linkedin_professional_v1'
    )
  )
)
ON CONFLICT (template_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  compatible_post_kinds = EXCLUDED.compatible_post_kinds,
  default_prompt_bundle = EXCLUDED.default_prompt_bundle,
  updated_at = now();

INSERT INTO public.social_render_template_prompts (render_template_key, slot, prompt_template_id, sort_order)
SELECT 'image_first_v1', v.slot, p.id, v.sort_order
FROM (VALUES
  ('caption_base', 0),
  ('guardrail', 10),
  ('post_kind_overlay', 20),
  ('platform_overlay_instagram', 30),
  ('platform_overlay_facebook', 40),
  ('platform_overlay_linkedin', 50)
) AS v(slot, sort_order)
JOIN public.social_prompt_templates p ON p.template_key = CASE v.slot
  WHEN 'caption_base' THEN 'caption_base_signal_v1'
  WHEN 'guardrail' THEN 'guardrail_financial_v1'
  WHEN 'post_kind_overlay' THEN 'overlay_single_image_v1'
  WHEN 'platform_overlay_instagram' THEN 'overlay_instagram_caption_v1'
  WHEN 'platform_overlay_facebook' THEN 'overlay_facebook_page_v1'
  WHEN 'platform_overlay_linkedin' THEN 'overlay_linkedin_professional_v1'
END
ON CONFLICT (render_template_key, slot, sort_order) DO NOTHING;

-- video_teaser_v1
INSERT INTO public.social_render_templates (
  template_key,
  display_name,
  description,
  renderer,
  layout_version,
  compatible_post_kinds,
  default_prompt_bundle
) VALUES (
  'video_teaser_v1',
  'Video teaser',
  'Hook-heavy captions for video and reel posts on TikTok, Instagram, and X.',
  'code_registry_v1',
  1,
  ARRAY['video', 'reel']::text[],
  jsonb_build_object(
    'caption_base', 'caption_base_hook_v1',
    'guardrail', 'guardrail_financial_v1',
    'post_kind_overlay', 'overlay_video_v1',
    'platform_overlay', jsonb_build_object(
      'tiktok', 'overlay_tiktok_short_v1',
      'instagram', 'overlay_instagram_caption_v1',
      'x', 'overlay_x_short_v1'
    )
  )
)
ON CONFLICT (template_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  compatible_post_kinds = EXCLUDED.compatible_post_kinds,
  default_prompt_bundle = EXCLUDED.default_prompt_bundle,
  updated_at = now();

INSERT INTO public.social_render_template_prompts (render_template_key, slot, prompt_template_id, sort_order)
SELECT 'video_teaser_v1', v.slot, p.id, v.sort_order
FROM (VALUES
  ('caption_base', 0),
  ('guardrail', 10),
  ('post_kind_overlay', 20),
  ('platform_overlay_tiktok', 30),
  ('platform_overlay_instagram', 40),
  ('platform_overlay_x', 50)
) AS v(slot, sort_order)
JOIN public.social_prompt_templates p ON p.template_key = CASE v.slot
  WHEN 'caption_base' THEN 'caption_base_hook_v1'
  WHEN 'guardrail' THEN 'guardrail_financial_v1'
  WHEN 'post_kind_overlay' THEN 'overlay_video_v1'
  WHEN 'platform_overlay_tiktok' THEN 'overlay_tiktok_short_v1'
  WHEN 'platform_overlay_instagram' THEN 'overlay_instagram_caption_v1'
  WHEN 'platform_overlay_x' THEN 'overlay_x_short_v1'
END
ON CONFLICT (render_template_key, slot, sort_order) DO NOTHING;

COMMIT;
