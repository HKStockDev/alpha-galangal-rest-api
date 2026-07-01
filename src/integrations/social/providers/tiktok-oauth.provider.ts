import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OAuthAuthorizeParams,
  OAuthTokenResponse,
  SocialOauthProvider,
} from '../interfaces/social-oauth-provider.interface';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_URL = 'https://open.tiktokapis.com/v2/user/info/';

@Injectable()
export class TiktokOauthProvider implements SocialOauthProvider {
  readonly platform = 'tiktok' as const;
  private readonly logger = new Logger(TiktokOauthProvider.name);

  constructor(private readonly config: ConfigService) {}

  requiresPkce(): boolean {
    return true;
  }

  private requireClient(): { clientKey: string; clientSecret: string; scopes: string[] } {
    const clientKey = this.config.get<string>('social.tiktok.clientKey')?.trim();
    const clientSecret = this.config.get<string>('social.tiktok.clientSecret')?.trim();
    const scopesRaw = this.config.get<string>('social.tiktok.scopes')?.trim();
    const scopes = (scopesRaw || 'user.info.basic,video.publish')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!clientKey || !clientSecret) {
      throw new ServiceUnavailableException(
        'TikTok OAuth is not configured (TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET).',
      );
    }
    return { clientKey, clientSecret, scopes };
  }

  buildAuthorizationUrl(params: OAuthAuthorizeParams): string {
    const { clientKey, scopes } = this.requireClient();
    if (!params.codeChallenge) {
      throw new ServiceUnavailableException('TikTok OAuth requires PKCE code_challenge.');
    }
    const u = new URL(AUTH_URL);
    u.searchParams.set('client_key', clientKey);
    u.searchParams.set('redirect_uri', params.redirectUri);
    u.searchParams.set('scope', scopes.join(','));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', params.state);
    u.searchParams.set('code_challenge', params.codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    options?: { codeVerifier?: string },
  ): Promise<OAuthTokenResponse> {
    if (!options?.codeVerifier) {
      throw new ServiceUnavailableException('TikTok OAuth exchange requires PKCE code_verifier.');
    }
    const { clientKey, clientSecret } = this.requireClient();
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: options.codeVerifier,
    });
    return this.postToken(body);
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
    const { clientKey, clientSecret } = this.requireClient();
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.postToken(body);
  }

  private async postToken(body: URLSearchParams): Promise<OAuthTokenResponse> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.logger.warn(`TikTok token non-JSON status=${res.status}`);
      throw new ServiceUnavailableException('TikTok token endpoint returned an invalid response.');
    }
    if (!res.ok) {
      const err = json.error as Record<string, unknown> | undefined;
      const msg =
        (typeof err?.message === 'string' ? err.message : '') ||
        (typeof json.message === 'string' ? json.message : text.slice(0, 200));
      this.logger.warn(`TikTok token error status=${res.status} body=${text.slice(0, 500)}`);
      throw new ServiceUnavailableException(`TikTok token exchange failed (${res.status}): ${msg}`);
    }
    const access_token = json.access_token as string | undefined;
    const expires_in = Number(json.expires_in);
    const refresh_token = typeof json.refresh_token === 'string' ? json.refresh_token : undefined;
    if (!access_token) {
      throw new ServiceUnavailableException('TikTok token response missing access_token.');
    }
    return {
      access_token,
      expires_in: Number.isFinite(expires_in) && expires_in > 0 ? expires_in : 86400,
      refresh_token,
      scope: typeof json.scope === 'string' ? json.scope : undefined,
    };
  }

  async fetchExternalIdentity(accessToken: string): Promise<{
    externalAccountId: string;
    accountLabel: string;
    externalAccountName: string | null;
  }> {
    const u = new URL(USER_URL);
    u.searchParams.set('fields', 'open_id,union_id,display_name,username');
    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException('TikTok user info returned non-JSON.');
    }
    if (!res.ok) {
      this.logger.warn(`TikTok user info failed status=${res.status} ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException(`TikTok user info failed (${res.status}).`);
    }
    const data = json.data as Record<string, unknown> | undefined;
    const user = data?.user as Record<string, unknown> | undefined;
    const openId = typeof user?.open_id === 'string' ? user.open_id : null;
    if (!openId) {
      throw new ServiceUnavailableException('TikTok user info missing open_id.');
    }
    const displayName = typeof user?.display_name === 'string' ? user.display_name : null;
    const username = typeof user?.username === 'string' ? user.username : null;
    return {
      externalAccountId: openId,
      accountLabel: username ? `@${username}` : displayName || 'TikTok',
      externalAccountName: displayName ?? username,
    };
  }
}
