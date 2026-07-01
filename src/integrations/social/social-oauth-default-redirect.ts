import { useProductionMetaAppCredentials } from '../../config/meta-credentials-profile';
import type { SocialOauthPlatform } from './constants';

/**
 * ConfigService paths for the default OAuth redirect URI per platform.
 */
export const SOCIAL_OAUTH_DEFAULT_REDIRECT_CONFIG_PATH: Record<SocialOauthPlatform, string> = {
  facebook: 'social.meta.redirectUri',
  instagram: 'social.meta.instagramRedirectUri',
  linkedin: 'social.linkedin.redirectUri',
  x: 'social.x.redirectUri',
  tiktok: 'social.tiktok.redirectUri',
};

/** Env var name for the default OAuth redirect (shown in API errors). */
export function socialOauthCallbackEnvVar(platform: SocialOauthPlatform): string {
  if (platform === 'facebook' || platform === 'instagram') {
    if (platform === 'instagram') {
      return useProductionMetaAppCredentials()
        ? 'META_INSTAGRAM_CALLBACK_URL_PRODUCTION'
        : 'META_INSTAGRAM_CALLBACK_URL_DEVELOPMENT';
    }
    return useProductionMetaAppCredentials()
      ? 'META_CALLBACK_URL_PRODUCTION'
      : 'META_CALLBACK_URL_DEVELOPMENT';
  }
  if (platform === 'linkedin') return 'LINKEDIN_CALLBACK_URL';
  if (platform === 'x') return 'X_CALLBACK_URL';
  return 'TIKTOK_CALLBACK_URL';
}
