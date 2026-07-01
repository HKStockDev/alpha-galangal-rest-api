import type { SocialOauthPlatform } from '../constants';

/** Woop Social platform enum values. */
export type WoopSocialPlatform =
  | 'PINTEREST'
  | 'LINKEDIN'
  | 'LINKEDIN_PAGES'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'THREADS'
  | 'TIKTOK'
  | 'X'
  | 'YOUTUBE'
  | 'WOOPTEST';

const CONVICTION_TO_WOOP: Record<SocialOauthPlatform, WoopSocialPlatform> = {
  linkedin: 'LINKEDIN',
  facebook: 'FACEBOOK',
  instagram: 'INSTAGRAM',
  x: 'X',
  tiktok: 'TIKTOK',
};

export function convictionPlatformToWoop(platform: SocialOauthPlatform): WoopSocialPlatform {
  return CONVICTION_TO_WOOP[platform];
}

/** Normalize Woop platform to Conviction UI platform slug. */
export function woopPlatformToConviction(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper === 'LINKEDIN_PAGES') return 'linkedin';
  if (upper === 'X') return 'x';
  return upper.toLowerCase();
}

export function woopStatusToConviction(status: string): 'active' | 'disconnected' {
  return status.toUpperCase() === 'CONNECTED' ? 'active' : 'disconnected';
}
