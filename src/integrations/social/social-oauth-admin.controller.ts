import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseAuthGuard } from '../../auth/guards/supabase-auth.guard';
import { PlatformAdminGuard } from '../../auth/guards/platform-admin.guard';
import { parseSocialOauthPlatform, supportedOauthPlatformsLabel } from './constants';
import { SocialOauthAuthorizeQueryDto } from './dto/social-oauth-authorize-query.dto';
import { SocialOauthExchangeDto } from './dto/social-oauth-exchange.dto';
import { SocialOauthRefreshDto } from './dto/social-oauth-refresh.dto';
import { ListSocialAccountsQueryDto } from './dto/list-social-accounts-query.dto';
import { SocialOauthService } from './social-oauth.service';
import { SocialAccountsService } from './social-accounts.service';

/**
 * Platform-agnostic social OAuth: facebook, instagram, linkedin, x, tiktok.
 */
@Controller('admin/integrations/social')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class SocialOauthAdminController {
  constructor(
    private readonly config: ConfigService,
    private readonly oauth: SocialOauthService,
    private readonly accounts: SocialAccountsService,
  ) {}

  /**
   * Precision org UUID from PRECISION_ORGANIZATION_ID when the client omits organization_id.
   */
  private resolveOrganizationId(explicit?: string): string {
    const trimmed = explicit?.trim();
    if (trimmed) {
      return trimmed;
    }
    const fromEnv = this.config.get<string>('social.precisionOrganizationId')?.trim();
    if (!fromEnv) {
      throw new BadRequestException(
        'Set PRECISION_ORGANIZATION_ID on the API server, or pass organization_id as a query parameter.',
      );
    }
    return fromEnv;
  }

  @Get('oauth/:platform/authorize-url')
  authorizeUrl(
    @Param('platform') platformRaw: string,
    @Query() query: SocialOauthAuthorizeQueryDto,
  ) {
    const platform = parseSocialOauthPlatform(platformRaw);
    if (!platform) {
      throw new BadRequestException(
        `Unknown platform "${platformRaw}". Supported: ${supportedOauthPlatformsLabel()}.`,
      );
    }
    return this.oauth.buildAuthorizeUrl({
      platform,
      organizationId: this.resolveOrganizationId(query.organization_id),
      redirectUri: query.redirect_uri,
    });
  }

  @Post('oauth/:platform/exchange')
  async exchange(
    @Param('platform') platformRaw: string,
    @Body() body: SocialOauthExchangeDto,
  ) {
    const platform = parseSocialOauthPlatform(platformRaw);
    if (!platform) {
      throw new BadRequestException(
        `Unknown platform "${platformRaw}". Supported: ${supportedOauthPlatformsLabel()}.`,
      );
    }
    return this.oauth.exchangeCode({
      platform,
      code: body.code,
      state: body.state,
      redirectUri: body.redirect_uri,
    });
  }

  @Post('oauth/:platform/refresh')
  async refresh(
    @Param('platform') platformRaw: string,
    @Body() body: SocialOauthRefreshDto,
    @Query('organization_id') organizationIdParam?: string,
  ) {
    const platform = parseSocialOauthPlatform(platformRaw);
    if (!platform) {
      throw new BadRequestException(
        `Unknown platform "${platformRaw}". Supported: ${supportedOauthPlatformsLabel()}.`,
      );
    }
    return this.oauth.refreshTokens({
      platform,
      organizationId: this.resolveOrganizationId(organizationIdParam),
      socialAccountId: body.social_account_id,
    });
  }

  @Get('accounts')
  listAccounts(@Query() query: ListSocialAccountsQueryDto) {
    return this.accounts.listAccountsForOrg(this.resolveOrganizationId(query.organization_id));
  }

  @Delete('accounts/:socialAccountId')
  disconnect(
    @Param('socialAccountId') socialAccountId: string,
    @Query('organization_id') organizationIdParam?: string,
  ) {
    return this.accounts
      .disconnect(this.resolveOrganizationId(organizationIdParam), socialAccountId)
      .then(() => ({ ok: true }));
  }
}
