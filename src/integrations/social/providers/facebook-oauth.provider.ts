import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  DiscoveredSocialAccount,
  OAuthAuthorizeParams,
  OAuthTokenResponse,
  SocialOauthProvider,
} from '../interfaces/social-oauth-provider.interface';
import {
  discoverMetaPageAccounts,
  exchangeMetaCodeForUserToken,
  metaDialogUrl,
  refreshMetaUserToken,
  requireMetaApp,
} from './meta-oauth.shared';

const DEFAULT_META_SCOPES =
  'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts';

@Injectable()
export class FacebookOauthProvider implements SocialOauthProvider {
  readonly platform = 'facebook' as const;
  private readonly logger = new Logger(FacebookOauthProvider.name);

  constructor(private readonly config: ConfigService) {}

  buildAuthorizationUrl(params: OAuthAuthorizeParams): string {
    const { appId, scope } = requireMetaApp(this.config, DEFAULT_META_SCOPES);
    const u = new URL(metaDialogUrl(this.config));
    u.searchParams.set('client_id', appId);
    u.searchParams.set('redirect_uri', params.redirectUri);
    u.searchParams.set('state', params.state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', scope);
    return u.toString();
  }

  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<OAuthTokenResponse> {
    return exchangeMetaCodeForUserToken(this.config, this.logger, code, redirectUri);
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
    return refreshMetaUserToken(this.config, this.logger, refreshToken);
  }

  async discoverAccounts(userAccessToken: string): Promise<DiscoveredSocialAccount[]> {
    const pages = await discoverMetaPageAccounts(this.config, this.logger, userAccessToken, 'facebook');
    if (!pages.length) {
      throw new BadRequestException(
        'No Facebook Pages found for this Meta login. Ensure the user manages a Page in Meta Business Manager.',
      );
    }
    return pages.map((p) => ({
      platform: p.platform,
      externalAccountId: p.externalAccountId,
      accountLabel: p.accountLabel,
      externalAccountName: p.externalAccountName,
      accessToken: p.accessToken,
      metadata: p.metadata,
    }));
  }

  async fetchExternalIdentity(accessToken: string): Promise<{
    externalAccountId: string;
    accountLabel: string;
    externalAccountName: string | null;
  }> {
    const rows = await this.discoverAccounts(accessToken);
    const first = rows[0];
    return {
      externalAccountId: first.externalAccountId,
      accountLabel: first.accountLabel,
      externalAccountName: first.externalAccountName,
    };
  }
}
