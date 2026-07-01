import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  DiscoveredSocialAccount,
  OAuthAuthorizeParams,
  OAuthTokenResponse,
  SocialOauthProvider,
} from '../interfaces/social-oauth-provider.interface';

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const ORG_ACLS_URL = 'https://api.linkedin.com/v2/organizationAcls';

@Injectable()
export class LinkedinOauthProvider implements SocialOauthProvider {
  readonly platform = 'linkedin' as const;
  private readonly logger = new Logger(LinkedinOauthProvider.name);

  constructor(private readonly config: ConfigService) {}

  private requireLinkedInClient(): { clientId: string; clientSecret: string; scopes: string[] } {
    const clientId = this.config.get<string>('social.linkedin.clientId')?.trim();
    const clientSecret = this.config.get<string>('social.linkedin.clientSecret')?.trim();
    const scopesRaw = this.config.get<string>('social.linkedin.scopes')?.trim();
    const scopes = (
      scopesRaw ||
      'openid profile email w_member_social w_organization_social r_organization_social'
    )
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'LinkedIn OAuth is not configured (LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET).',
      );
    }
    return { clientId, clientSecret, scopes };
  }

  buildAuthorizationUrl(params: OAuthAuthorizeParams): string {
    const { clientId, scopes } = this.requireLinkedInClient();
    const u = new URL(AUTH_URL);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', params.redirectUri);
    u.searchParams.set('state', params.state);
    u.searchParams.set('scope', scopes.join(' '));
    return u.toString();
  }

  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<OAuthTokenResponse> {
    const { clientId, clientSecret } = this.requireLinkedInClient();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    return this.postToken(body);
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
    const { clientId, clientSecret } = this.requireLinkedInClient();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
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
      this.logger.warn(`LinkedIn token non-JSON response status=${res.status}`);
      throw new ServiceUnavailableException('LinkedIn token endpoint returned an invalid response.');
    }
    if (!res.ok) {
      const msg =
        typeof json.error_description === 'string'
          ? json.error_description
          : typeof json.message === 'string'
            ? json.message
            : text.slice(0, 200);
      this.logger.warn(`LinkedIn token error status=${res.status} body=${text.slice(0, 500)}`);
      throw new ServiceUnavailableException(
        `LinkedIn token exchange failed (${res.status}): ${msg || 'unknown error'}`,
      );
    }
    const access_token = json.access_token as string | undefined;
    const expires_in = Number(json.expires_in);
    if (!access_token || !Number.isFinite(expires_in)) {
      throw new ServiceUnavailableException('LinkedIn token response missing access_token or expires_in.');
    }
    return {
      access_token,
      expires_in,
      refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      refresh_token_expires_in:
        typeof json.refresh_token_expires_in === 'number' ? json.refresh_token_expires_in : undefined,
      scope: typeof json.scope === 'string' ? json.scope : undefined,
    };
  }

  async discoverAccounts(accessToken: string): Promise<DiscoveredSocialAccount[]> {
    const orgs = await this.fetchAdminOrganizations(accessToken);
    if (orgs.length) {
      return orgs;
    }
    const user = await this.fetchExternalIdentity(accessToken);
    return [{ ...user, metadata: { linkedin_resource_type: 'member' } }];
  }

  private async fetchAdminOrganizations(accessToken: string): Promise<DiscoveredSocialAccount[]> {
    const u = new URL(ORG_ACLS_URL);
    u.searchParams.set('q', 'roleAssignee');
    u.searchParams.set('role', 'ADMINISTRATOR');
    u.searchParams.set('state', 'APPROVED');
    u.searchParams.set('projection', '(elements*(organization~(localizedName,vanityName),organization))');

    const res = await fetch(u.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.warn(
        `LinkedIn organizationAcls failed status=${res.status} (Community API may be pending — CON-180). ${text.slice(0, 300)}`,
      );
      return [];
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return [];
    }
    const elements = Array.isArray(json.elements) ? json.elements : [];
    const out: DiscoveredSocialAccount[] = [];
    const seen = new Set<string>();

    for (const el of elements) {
      if (!el || typeof el !== 'object') continue;
      const row = el as Record<string, unknown>;
      const orgField = row.organization as string | undefined;
      const orgUrn = typeof orgField === 'string' ? orgField : null;
      if (!orgUrn || seen.has(orgUrn)) continue;
      seen.add(orgUrn);

      const expanded = row['organization~'] as Record<string, unknown> | undefined;
      const localizedName =
        typeof expanded?.localizedName === 'string' ? expanded.localizedName : null;
      const vanityName = typeof expanded?.vanityName === 'string' ? expanded.vanityName : null;
      const orgId = orgUrn.replace('urn:li:organization:', '');

      out.push({
        platform: 'linkedin',
        externalAccountId: orgId || orgUrn,
        accountLabel: localizedName?.trim() || vanityName || `LinkedIn Org ${orgId}`,
        externalAccountName: localizedName ?? vanityName,
        metadata: {
          linkedin_resource_type: 'organization',
          linkedin_organization_urn: orgUrn,
          linkedin_vanity_name: vanityName,
        },
      });
    }
    return out;
  }

  async fetchExternalIdentity(accessToken: string): Promise<{
    externalAccountId: string;
    accountLabel: string;
    externalAccountName: string | null;
  }> {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException('LinkedIn userinfo returned non-JSON.');
    }
    if (!res.ok) {
      this.logger.warn(`LinkedIn userinfo failed status=${res.status} ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException(
        `LinkedIn userinfo failed (${res.status}). Ensure openid scope and Sign In with LinkedIn product are enabled.`,
      );
    }
    const sub = json.sub as string | undefined;
    if (!sub) {
      throw new ServiceUnavailableException('LinkedIn userinfo missing sub.');
    }
    const name = typeof json.name === 'string' ? json.name : null;
    const given = typeof json.given_name === 'string' ? json.given_name : '';
    const family = typeof json.family_name === 'string' ? json.family_name : '';
    const composed = [given, family].filter(Boolean).join(' ').trim() || name;
    return {
      externalAccountId: sub,
      accountLabel: composed || 'LinkedIn',
      externalAccountName: name ?? (composed || null),
    };
  }
}
