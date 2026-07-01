BEGIN;

INSERT INTO public.social_prompt_templates (
  template_key, channel, post_kind, purpose, prompt_role, template_text, required_context_keys, change_note
) VALUES
  (
    'overlay_instagram_caption_v1',
    'instagram',
    'all',
    'caption',
    'platform_overlay',
    $p$Platform: Instagram.
- Visual-first caption; mention the image/card when relevant.
- 1-3 short lines; up to 5 hashtags at the end.
- Conversational but professional.$p$,
    '{}'::text[],
    'Instagram overlay'
  ),
  (
    'overlay_tiktok_short_v1',
    'tiktok',
    'all',
    'caption',
    'platform_overlay',
    $p$Platform: TikTok.
- Very short hook in the first line.
- Max 150 characters for caption text.
- 1-3 trending-style hashtags only if relevant.$p$,
    '{}'::text[],
    'TikTok overlay'
  ),
  (
    'overlay_stocktwits_v1',
    'stocktwits',
    'all',
    'caption',
    'platform_overlay',
    $p$Platform: StockTwits.
- Lead with cashtag ${{ticker}} when ticker is provided.
- Trader-oriented tone; no hype.
- Max 140 characters.$p$,
    ARRAY['ticker'],
    'StockTwits overlay'
  ),
  (
    'overlay_single_image_v1',
    'all',
    'single_image',
    'caption',
    'post_kind_overlay',
    $p$Post type: single image.
- Reference the visual briefly; do not describe pixels you cannot see.
- Caption should stand alone if the image fails to load.$p$,
    '{}'::text[],
    'single_image overlay'
  ),
  (
    'overlay_video_v1',
    'all',
    'video',
    'caption',
    'post_kind_overlay',
    $p$Post type: video.
- Open with a hook suitable for autoplay mute.
- Mention that details are in the video or at the link.$p$,
    '{}'::text[],
    'video overlay'
  ),
  (
    'image_generation_base_signal_v1',
    'all',
    'all',
    'image_generation',
    'base',
    $p$Generate a 1200x630 social card image for a stock screener signal.
Ticker: {{ticker}}
Signal: {{signal_name}}
Summary: {{summary}}
Style: clean, professional, dark navy background, minimal text, no logos.$p$,
    ARRAY['ticker', 'signal_name', 'summary'],
    'image generation base'
  )
ON CONFLICT (template_key) DO NOTHING;

UPDATE public.social_render_templates
SET default_prompt_bundle = jsonb_set(
  default_prompt_bundle,
  '{platform_overlay,instagram}',
  '"overlay_instagram_caption_v1"'::jsonb,
  true
)
WHERE template_key = 'signal_card_v1'
  AND NOT (default_prompt_bundle->'platform_overlay' ? 'instagram');

COMMIT;
