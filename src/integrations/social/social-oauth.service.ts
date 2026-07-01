import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SocialOauthPlatform } from './constants';
import {
  SOCIAL_OAUTH_DEFAULT_REDIRECT_CONFIG_PATH,
  socialOauthCallbackEnvVar,
} from './social-oauth-default-redirect';
import { generatePkcePair } from './providers/oauth-pkce.util';
import { SocialOauthRegistryService } from './social-oauth-registry.service';
import { SocialOauthStateService } from './social-oauth-state.service';
import { SocialAccountsService } from './social-accounts.service';
import { WoopSocialService } from './woop/woop-social.service';
import type { DiscoveredSocialAccount } from './interfaces/social-oauth-provider.interface';

@Injectable()
export class SocialOauthService {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: SocialOauthRegistryService,
    private readonly state: SocialOauthStateService,
    private readonly accounts: SocialAccountsService,
    private readonly woop: WoopSocialService,
  ) {}

  private useWoop(): boolean {
    return this.woop.isEnabled();
  }

  private defaultRedirectUri(platform: SocialOauthPlatform): string {
    const path = SOCIAL_OAUTH_DEFAULT_REDIRECT_CONFIG_PATH[platform];
    const u = this.config.get<string>(path)?.trim();
    if (!u) {
      const env = socialOauthCallbackEnvVar(platform);
      throw new BadRequestException(
        `${env} is not set; it must match an authorized redirect URL for this platform in the developer console. ` +
          `Optional request fields redirect_uri (authorize query, exchange body) override this default.`,
      );
    }
    return u;
  }

  async buildAuthorizeUrl(params: {
    platform: SocialOauthPlatform;
    organizationId: string;
    redirectUri?: string;
  }): Promise<{ authorization_url: string; state: string; redirect_uri: string }> {
    const redirectUri = (params.redirectUri?.trim() || this.defaultRedirectUri(params.platform)).trim();

    if (this.useWoop()) {
      const woop = await this.woop.createAuthorizationUrl({
        platform: params.platform,
        redirectUrl: redirectUri,
      });
      return {
        authorization_url: woop.url,
        state: '',
        redirect_uri: woop.redirect_uri,
      };
    }

    const provider = this.registry.getProvider(params.platform);

    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;
    if (provider.requiresPkce?.()) {
      const pair = generatePkcePair();
      codeVerifier = pair.codeVerifier;
      codeChallenge = pair.codeChallenge;
    }

    const st = this.state.createState(params.organizationId, params.platform, codeVerifier);
    const authorization_url = provider.buildAuthorizationUrl({
      redirectUri,
      state: st,
      scopes: [],
      codeChallenge,
    });
    return { authorization_url, state: st, redirect_uri: redirectUri };
  }

  async exchangeCode(params: {
    platform: SocialOauthPlatform;
    code: string;
    state: string;
    redirectUri?: string;
  }): Promise<{
    social_account_id: string;
    social_account_ids: string[];
    platform: SocialOauthPlatform;
    discovered_count: number;
  }> {
    if (this.useWoop()) {
      return {
        social_account_id: '',
        social_account_ids: [],
        platform: params.platform,
        discovered_count: 0,
      };
    }

    const { organizationId, codeVerifier } = this.state.verifyAndConsume(params.state, params.platform);
    const provider = this.registry.getProvider(params.platform);
    const redirectUri = (params.redirectUri?.trim() || this.defaultRedirectUri(params.platform)).trim();
    const token = await provider.exchangeAuthorizationCode(params.code.trim(), redirectUri, {
      codeVerifier,
    });

    const discovered = await this.resolveDiscoveredAccounts(provider, token.access_token);
    if (!discovered.length) {
      throw new BadRequestException('OAuth succeeded but no connectable accounts were found.');
    }

    const savedIds: string[] = [];
    for (const row of discovered) {
      const accountPlatform = row.platform ?? params.platform;
      const accessToken = row.accessToken ?? token.access_token;
      const saved = await this.accounts.persistOAuthTokens({
        organizationId,
        platform: accountPlatform,
        externalAccountId: row.externalAccountId,
        accountLabel: row.accountLabel,
        externalAccountName: row.externalAccountName,
        token: {
          ...token,
          access_token: accessToken,
          refresh_token: token.refresh_token ?? accessToken,
        },
        metadata: row.metadata,
      });
      savedIds.push(saved.social_account_id);
    }

    return {
      social_account_id: savedIds[0],
      social_account_ids: savedIds,
      platform: params.platform,
      discovered_count: savedIds.length,
    };
  }

  private async resolveDiscoveredAccounts(
    provider: ReturnType<SocialOauthRegistryService['getProvider']>,
    accessToken: string,
  ): Promise<DiscoveredSocialAccount[]> {
    if (provider.discoverAccounts) {
      return provider.discoverAccounts(accessToken);
    }
    const identity = await provider.fetchExternalIdentity(accessToken);
    return [identity];
  }

  async refreshTokens(params: {
    platform: SocialOauthPlatform;
    organizationId: string;
    socialAccountId: string;
  }): Promise<{ social_account_id: string }> {
    if (this.useWoop()) {
      throw new BadRequestException(
        'Token refresh is managed by Woop Social; reconnect the account if needed.',
      );
    }

    const row = await this.accounts.getAccountForOrg(params.organizationId, params.socialAccountId);
    if (row.platform !== params.platform) {
      throw new BadRequestException('Account platform does not match the requested OAuth platform.');
    }
    const provider = this.registry.getProvider(params.platform);
    const { refresh_token } = await this.accounts.loadCredentialsForRefresh(params.socialAccountId);
    if (!refresh_token) {
      throw new BadRequestException(
        'No refresh token on file; reconnect via the authorization flow.',
      );
    }
    const token = await provider.refreshAccessToken(refresh_token);

    if (provider.discoverAccounts) {
      const discovered = await provider.discoverAccounts(token.access_token);
      const match = discovered.find((d) => d.externalAccountId === row.external_account_id);
      if (match?.accessToken) {
        token.access_token = match.accessToken;
        token.refresh_token = token.refresh_token ?? match.accessToken;
      } else if (discovered.length === 1 && discovered[0].accessToken) {
        token.access_token = discovered[0].accessToken;
        token.refresh_token = token.refresh_token ?? discovered[0].accessToken;
      }
    }

    await this.accounts.updateTokensAfterRefresh(params.socialAccountId, token);
    return { social_account_id: params.socialAccountId };
  }
}
