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

const PRECISION_TO_WOOP: Record<SocialOauthPlatform, WoopSocialPlatform> = {
  linkedin: 'LINKEDIN',
  facebook: 'FACEBOOK',
  instagram: 'INSTAGRAM',
  x: 'X',
  tiktok: 'TIKTOK',
};

export function precisionPlatformToWoop(platform: SocialOauthPlatform): WoopSocialPlatform {
  return PRECISION_TO_WOOP[platform];
}

/** Normalize Woop platform to Precision UI platform slug. */
export function woopPlatformToPrecision(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper === 'LINKEDIN_PAGES') return 'linkedin';
  if (upper === 'X') return 'x';
  return upper.toLowerCase();
}

export function woopStatusToPrecision(status: string): 'active' | 'disconnected' {
  return status.toUpperCase() === 'CONNECTED' ? 'active' : 'disconnected';
}
