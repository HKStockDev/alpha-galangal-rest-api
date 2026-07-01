/** Path param `:platform` — extend when adding OAuth providers. */
export const SOCIAL_OAUTH_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'x', 'tiktok'] as const;
export type SocialOauthPlatform = (typeof SOCIAL_OAUTH_PLATFORMS)[number];

/** Platforms stored on social_accounts (includes non-OAuth channels). */
export const SOCIAL_ACCOUNT_PLATFORMS = [
  'facebook',
  'instagram',
  'tiktok',
  'stocktwits',
  'x',
  'linkedin',
] as const;
export type SocialAccountPlatform = (typeof SOCIAL_ACCOUNT_PLATFORMS)[number];

export function parseSocialOauthPlatform(raw: string): SocialOauthPlatform | null {
  const x = (raw || '').toLowerCase();
  return (SOCIAL_OAUTH_PLATFORMS as readonly string[]).includes(x) ? (x as SocialOauthPlatform) : null;
}

export function supportedOauthPlatformsLabel(): string {
  return SOCIAL_OAUTH_PLATFORMS.join(', ');
}
