import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OAuthAuthorizeParams,
  OAuthTokenResponse,
  SocialOauthProvider,
} from '../interfaces/social-oauth-provider.interface';

const AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const USER_URL = 'https://api.twitter.com/2/users/me';

@Injectable()
export class XOauthProvider implements SocialOauthProvider {
  readonly platform = 'x' as const;
  private readonly logger = new Logger(XOauthProvider.name);

  constructor(private readonly config: ConfigService) {}

  requiresPkce(): boolean {
    return true;
  }

  private requireClient(): { clientId: string; clientSecret: string; scopes: string[] } {
    const clientId = this.config.get<string>('social.x.clientId')?.trim();
    const clientSecret = this.config.get<string>('social.x.clientSecret')?.trim();
    const scopesRaw = this.config.get<string>('social.x.scopes')?.trim();
    const scopes = (scopesRaw || 'tweet.read tweet.write users.read offline.access')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'X OAuth is not configured (X_CLIENT_ID, X_CLIENT_SECRET).',
      );
    }
    return { clientId, clientSecret, scopes };
  }

  buildAuthorizationUrl(params: OAuthAuthorizeParams): string {
    const { clientId, scopes } = this.requireClient();
    if (!params.codeChallenge) {
      throw new ServiceUnavailableException('X OAuth requires PKCE code_challenge.');
    }
    const u = new URL(AUTH_URL);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', params.redirectUri);
    u.searchParams.set('scope', scopes.join(' '));
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
      throw new ServiceUnavailableException('X OAuth exchange requires PKCE code_verifier.');
    }
    const { clientId, clientSecret } = this.requireClient();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: options.codeVerifier,
    });
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    return this.postToken(body, basic);
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
    const { clientId, clientSecret } = this.requireClient();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    return this.postToken(body, basic);
  }

  private async postToken(body: URLSearchParams, basicAuth: string): Promise<OAuthTokenResponse> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: body.toString(),
    });
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.logger.warn(`X token non-JSON status=${res.status}`);
      throw new ServiceUnavailableException('X token endpoint returned an invalid response.');
    }
    if (!res.ok) {
      const msg =
        typeof json.error_description === 'string'
          ? json.error_description
          : typeof json.error === 'string'
            ? json.error
            : text.slice(0, 200);
      this.logger.warn(`X token error status=${res.status} body=${text.slice(0, 500)}`);
      throw new ServiceUnavailableException(`X token exchange failed (${res.status}): ${msg}`);
    }
    const access_token = json.access_token as string | undefined;
    const expires_in = Number(json.expires_in);
    if (!access_token || !Number.isFinite(expires_in)) {
      throw new ServiceUnavailableException('X token response missing access_token or expires_in.');
    }
    return {
      access_token,
      expires_in,
      refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      scope: typeof json.scope === 'string' ? json.scope : undefined,
    };
  }

  async fetchExternalIdentity(accessToken: string): Promise<{
    externalAccountId: string;
    accountLabel: string;
    externalAccountName: string | null;
  }> {
    const res = await fetch(`${USER_URL}?user.fields=username,name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException('X users/me returned non-JSON.');
    }
    if (!res.ok) {
      this.logger.warn(`X users/me failed status=${res.status} ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException(`X users/me failed (${res.status}).`);
    }
    const data = json.data as Record<string, unknown> | undefined;
    const id = typeof data?.id === 'string' ? data.id : null;
    if (!id) {
      throw new ServiceUnavailableException('X users/me missing user id.');
    }
    const username = typeof data?.username === 'string' ? data.username : null;
    const name = typeof data?.name === 'string' ? data.name : null;
    return {
      externalAccountId: id,
      accountLabel: username ? `@${username}` : name || 'X',
      externalAccountName: name ?? username,
    };
  }
}
