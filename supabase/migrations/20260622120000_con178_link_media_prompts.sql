BEGIN;

-- Link image generation prompt to visual render scripts
UPDATE public.social_render_templates
SET default_prompt_bundle = jsonb_set(
  default_prompt_bundle,
  '{image_generation}',
  '"image_generation_base_signal_v1"'::jsonb,
  true
),
updated_at = now()
WHERE template_key IN ('signal_card_v1', 'image_first_v1');

INSERT INTO public.social_render_template_prompts (render_template_key, slot, prompt_template_id, sort_order)
SELECT v.render_key, 'image_generation', p.id, 90
FROM (VALUES ('signal_card_v1'), ('image_first_v1')) AS v(render_key)
JOIN public.social_prompt_templates p ON p.template_key = 'image_generation_base_signal_v1'
ON CONFLICT (render_template_key, slot, sort_order) DO NOTHING;

-- Video script prompt for video teaser render script
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
  'video_script_teaser_v1',
  'all',
  'video',
  'video_script',
  'base',
  $prompt$Write a short video script (15–30 seconds) for a stock screener signal teaser.

Organization: {{organization_name}}
Ticker: {{ticker}}
Signal: {{signal_name}}
Summary: {{summary}}
Link: {{page_url}}

Format:
- HOOK (first 3 seconds): bold question or stat
- BODY: 1–2 sentences from the summary only
- CTA: mention the link verbally
- On-screen text cues in [brackets] where helpful
- No invented facts. Not investment advice.$prompt$,
  ARRAY['ticker', 'signal_name', 'summary', 'page_url', 'organization_name'],
  'video script for video_teaser_v1'
)
ON CONFLICT (template_key) DO NOTHING;

UPDATE public.social_render_templates
SET default_prompt_bundle = jsonb_set(
  default_prompt_bundle,
  '{video_script}',
  '"video_script_teaser_v1"'::jsonb,
  true
),
updated_at = now()
WHERE template_key = 'video_teaser_v1';

INSERT INTO public.social_render_template_prompts (render_template_key, slot, prompt_template_id, sort_order)
SELECT 'video_teaser_v1', 'video_script', p.id, 90
FROM public.social_prompt_templates p
WHERE p.template_key = 'video_script_teaser_v1'
ON CONFLICT (render_template_key, slot, sort_order) DO NOTHING;

COMMIT;
