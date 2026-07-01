export const PROMPT_CHANNELS = [
  'all',
  'facebook',
  'instagram',
  'tiktok',
  'stocktwits',
  'x',
  'linkedin',
] as const;

export const PROMPT_POST_KINDS = [
  'all',
  'text',
  'single_image',
  'multi_image',
  'gif',
  'video',
  'reel',
  'story',
  'link_share',
  'thread_reply',
  'live_stream',
  'poll',
] as const;

export const PROMPT_PURPOSES = [
  'caption',
  'hashtag_pack',
  'image_generation',
  'video_generation',
  'video_script',
  'thread_reply_body',
] as const;

export const PROMPT_ROLES = [
  'base',
  'platform_overlay',
  'post_kind_overlay',
  'guardrail',
  'normalizer',
] as const;

export type PromptChannel = (typeof PROMPT_CHANNELS)[number];
export type PromptPostKind = (typeof PROMPT_POST_KINDS)[number];
export type PromptPurpose = (typeof PROMPT_PURPOSES)[number];
export type PromptRole = (typeof PROMPT_ROLES)[number];
