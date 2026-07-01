import type { SocialOauthPlatform } from '../constants';

export type OAuthAuthorizeParams = {
  redirectUri: string;
  state: string;
  scopes: string[];
  /** PKCE S256 challenge (X, TikTok). */
  codeChallenge?: string;
};

export type OAuthTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

export type DiscoveredSocialAccount = {
  /** Defaults to provider.platform when omitted. */
  platform?: SocialOauthPlatform | 'instagram';
  externalAccountId: string;
  accountLabel: string;
  externalAccountName: string | null;
  /** When set, persisted instead of the OAuth user token (e.g. Meta page token). */
  accessToken?: string;
  metadata?: Record<string, unknown>;
};

export interface SocialOauthProvider {
  readonly platform: SocialOauthPlatform;

  /** OAuth 2.0 PKCE (X, TikTok). */
  requiresPkce?(): boolean;

  buildAuthorizationUrl(params: OAuthAuthorizeParams): string;

  exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    options?: { codeVerifier?: string },
  ): Promise<OAuthTokenResponse>;

  refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse>;

  fetchExternalIdentity(accessToken: string): Promise<{
    externalAccountId: string;
    accountLabel: string;
    externalAccountName: string | null;
  }>;

  /**
   * When implemented, exchange persists every discovered account (e.g. Meta pages + IG).
   * Each row may override platform and accessToken.
   */
  discoverAccounts?(accessToken: string): Promise<DiscoveredSocialAccount[]>;
}
