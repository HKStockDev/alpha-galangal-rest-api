import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret, deriveKeyFromSecret, encryptSecret } from '../../lib/social-token-crypto';
import type { OAuthTokenResponse } from './interfaces/social-oauth-provider.interface';
import type { SocialAccountPlatform } from './constants';
import { WoopSocialService } from './woop/woop-social.service';
import { woopPlatformToConviction } from './woop/woop-platform.util';

@Injectable()
export class SocialAccountsService {
  private readonly logger = new Logger(SocialAccountsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly woop: WoopSocialService,
  ) {}

  private adminClient(): SupabaseClient {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (!url || !(serviceRoleKey || anonKey)) {
      throw new ServiceUnavailableException('Supabase is not configured for social account persistence.');
    }
    return createClient(url, serviceRoleKey ?? anonKey!);
  }

  private tokenKey(): Buffer {
    const explicit = this.config.get<string>('social.tokenEncryptionKey')?.trim();
    const sr = this.config.get<string>('supabase.serviceRoleKey')?.trim();
    const material = explicit || sr;
    if (!material) {
      throw new ServiceUnavailableException(
        'Set SOCIAL_TOKEN_ENCRYPTION_KEY or SUPABASE_SERVICE_ROLE_KEY to encrypt OAuth tokens.',
      );
    }
    return deriveKeyFromSecret(material);
  }

  async persistOAuthTokens(params: {
    organizationId: string;
    platform: SocialAccountPlatform;
    externalAccountId: string;
    accountLabel: string;
    externalAccountName: string | null;
    token: OAuthTokenResponse;
    metadata?: Record<string, unknown>;
  }): Promise<{ social_account_id: string }> {
    const db = this.adminClient();
    const key = this.tokenKey();
    const accessEnc = encryptSecret(params.token.access_token, key);
    const refreshEnc = params.token.refresh_token
      ? encryptSecret(params.token.refresh_token, key)
      : null;
    const expiresAt = new Date(Date.now() + params.token.expires_in * 1000).toISOString();
    const scopes = params.token.scope
      ? decodeURIComponent(params.token.scope)
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const { data: existing, error: findErr } = await db
      .from('social_accounts')
      .select('id')
      .eq('organization_id', params.organizationId)
      .eq('platform', params.platform)
      .eq('external_account_id', params.externalAccountId)
      .maybeSingle();
    if (findErr) {
      this.logger.error(findErr.message);
      throw new BadRequestException('Failed to look up social account.');
    }

    let accountId: string;
    if (existing?.id) {
      accountId = existing.id as string;
      const { error: updErr } = await db
        .from('social_accounts')
        .update({
          account_label: params.accountLabel,
          external_account_name: params.externalAccountName,
          status: 'active',
          last_error_at: null,
          last_error_message: null,
          ...(params.metadata ? { metadata: params.metadata } : {}),
        })
        .eq('id', accountId);
      if (updErr) {
        this.logger.error(updErr.message);
        throw new BadRequestException('Failed to update social account.');
      }
    } else {
      const { data: ins, error: insErr } = await db
        .from('social_accounts')
        .insert({
          organization_id: params.organizationId,
          platform: params.platform,
          account_label: params.accountLabel,
          external_account_id: params.externalAccountId,
          external_account_name: params.externalAccountName,
          status: 'active',
          metadata: params.metadata ?? {},
        })
        .select('id')
        .single();
      if (insErr || !ins) {
        this.logger.error(insErr?.message);
        throw new BadRequestException('Failed to create social account.');
      }
      accountId = (ins as { id: string }).id;
    }

    const { error: credErr } = await db.from('social_account_credentials').upsert(
      {
        social_account_id: accountId,
        token_type: 'oauth2',
        access_token_encrypted: accessEnc,
        refresh_token_encrypted: refreshEnc,
        token_expires_at: expiresAt,
        scopes,
        last_refreshed_at: new Date().toISOString(),
        last_refresh_error_at: null,
        last_refresh_error_message: null,
      },
      { onConflict: 'social_account_id' },
    );
    if (credErr) {
      this.logger.error(credErr.message);
      throw new BadRequestException('Failed to save credentials.');
    }

    return { social_account_id: accountId };
  }

  async listAccountsForOrg(organizationId: string): Promise<unknown[]> {
    if (this.woop.isEnabled()) {
      return this.woop.listAccounts();
    }

    const db = this.adminClient();
    const { data, error } = await db
      .from('social_accounts')
      .select(
        'id, organization_id, platform, account_label, external_account_id, external_account_name, status, metadata, last_successful_publish_at, last_error_at, last_error_message, created_at, updated_at, social_account_credentials ( token_expires_at, last_refreshed_at, last_refresh_error_at, last_refresh_error_message, scopes )',
      )
      .eq('organization_id', organizationId)
      .order('platform');
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to list social accounts.');
    }
    return data ?? [];
  }

  async getAccountForOrg(organizationId: string, socialAccountId: string): Promise<{
    id: string;
    platform: string;
    organization_id: string;
    external_account_id: string;
    woop_social_account_id?: string;
  }> {
    if (this.woop.isEnabled()) {
      const accounts = await this.woop.listAccounts();
      let found = accounts.find((a) => a.id === socialAccountId);

      if (!found) {
        const db = this.adminClient();
        const { data: shadow, error } = await db
          .from('social_accounts')
          .select('id, platform, organization_id, external_account_id, metadata')
          .eq('id', socialAccountId)
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (error) {
          this.logger.error(error.message);
          throw new BadRequestException('Failed to look up social account.');
        }
        if (shadow) {
          const woopId = (shadow.metadata as { woop_social_account_id?: string } | null)
            ?.woop_social_account_id;
          if (woopId) {
            found = accounts.find((a) => a.id === woopId);
          }
          if (!found && shadow.external_account_id) {
            found = accounts.find(
              (a) =>
                woopPlatformToConviction(a.platform) === shadow.platform &&
                a.external_account_id === shadow.external_account_id,
            );
          }
        }
      }

      if (!found) {
        throw new NotFoundException('Social account not found.');
      }
      const localId = await this.ensureWoopShadowAccount(organizationId, found);
      return {
        id: localId,
        platform: found.platform,
        organization_id: found.organization_id,
        external_account_id: found.external_account_id ?? found.id,
        woop_social_account_id: found.id,
      };
    }

    const db = this.adminClient();
    const { data, error } = await db
      .from('social_accounts')
      .select('id, platform, organization_id, external_account_id')
      .eq('id', socialAccountId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException('Social account not found.');
    }
    return data as {
      id: string;
      platform: string;
      organization_id: string;
      external_account_id: string;
    };
  }

  /** Upsert a local social_accounts row for a Woop-connected account (FK for social_posts). */
  private async ensureWoopShadowAccount(
    organizationId: string,
    woopAccount: {
      id: string;
      platform: string;
      account_label: string | null;
      external_account_id: string | null;
      external_account_name: string | null;
      status: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<string> {
    const db = this.adminClient();
    const externalId = woopAccount.external_account_id?.trim() || woopAccount.id;
    const metadata = {
      ...woopAccount.metadata,
      woop: true,
      woop_social_account_id: woopAccount.id,
    };

    const { data: existing, error: findErr } = await db
      .from('social_accounts')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform', woopAccount.platform)
      .eq('external_account_id', externalId)
      .maybeSingle();
    if (findErr) {
      this.logger.error(findErr.message);
      throw new BadRequestException('Failed to look up Woop shadow account.');
    }

    if (existing?.id) {
      await db
        .from('social_accounts')
        .update({
          account_label: woopAccount.account_label ?? woopAccount.platform,
          external_account_name: woopAccount.external_account_name,
          status: woopAccount.status,
          metadata,
        })
        .eq('id', existing.id);
      return String(existing.id);
    }

    const { data: inserted, error: insertErr } = await db
      .from('social_accounts')
      .insert({
        organization_id: organizationId,
        platform: woopAccount.platform,
        account_label: woopAccount.account_label ?? woopAccount.platform,
        external_account_id: externalId,
        external_account_name: woopAccount.external_account_name,
        status: woopAccount.status,
        metadata,
      })
      .select('id')
      .single();
    if (insertErr || !inserted) {
      this.logger.error(insertErr?.message);
      throw new BadRequestException('Failed to create Woop shadow account.');
    }
    return String(inserted.id);
  }

  async loadCredentialsForRefresh(socialAccountId: string): Promise<{
    refresh_token: string | null;
    access_token: string;
  }> {
    const db = this.adminClient();
    const key = this.tokenKey();
    const { data, error } = await db
      .from('social_account_credentials')
      .select('access_token_encrypted, refresh_token_encrypted')
      .eq('social_account_id', socialAccountId)
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException('No credentials stored for this account.');
    }
    const row = data as { access_token_encrypted: string; refresh_token_encrypted: string | null };
    const access_token = decryptSecret(row.access_token_encrypted, key);
    const refresh_token = row.refresh_token_encrypted
      ? decryptSecret(row.refresh_token_encrypted, key)
      : null;
    return { refresh_token, access_token };
  }

  async updateTokensAfterRefresh(
    socialAccountId: string,
    token: OAuthTokenResponse,
  ): Promise<void> {
    const db = this.adminClient();
    const key = this.tokenKey();
    const accessEnc = encryptSecret(token.access_token, key);
    const refreshEnc = token.refresh_token ? encryptSecret(token.refresh_token, key) : null;
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
    const { error } = await db
      .from('social_account_credentials')
      .update({
        access_token_encrypted: accessEnc,
        refresh_token_encrypted: refreshEnc,
        token_expires_at: expiresAt,
        last_refreshed_at: new Date().toISOString(),
        last_refresh_error_at: null,
        last_refresh_error_message: null,
      })
      .eq('social_account_id', socialAccountId);
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to update tokens after refresh.');
    }
  }

  async disconnect(organizationId: string, socialAccountId: string): Promise<void> {
    if (this.woop.isEnabled()) {
      await this.woop.deleteAccount(socialAccountId);
      return;
    }

    const db = this.adminClient();
    await this.getAccountForOrg(organizationId, socialAccountId);
    await db.from('social_account_credentials').delete().eq('social_account_id', socialAccountId);
    const { error } = await db
      .from('social_accounts')
      .update({ status: 'disconnected', last_error_at: null, last_error_message: null })
      .eq('id', socialAccountId);
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to disconnect social account.');
    }
  }

  async findActiveAccountForPlatform(
    organizationId: string,
    platform: string,
  ): Promise<{
    id: string;
    platform: string;
    account_label: string;
    external_account_id: string;
  } | null> {
    if (this.woop.isEnabled()) {
      const accounts = await this.woop.listAccounts();
      const found = accounts.find(
        (a) => a.platform === platform && (a.status ?? '').toLowerCase() === 'active',
      );
      if (!found) return null;
      return {
        id: found.id,
        platform: found.platform,
        account_label: found.account_label ?? found.external_account_name ?? platform,
        external_account_id: found.external_account_id ?? found.id,
      };
    }

    const db = this.adminClient();
    const { data, error } = await db
      .from('social_accounts')
      .select('id, platform, account_label, external_account_id')
      .eq('organization_id', organizationId)
      .eq('platform', platform)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      this.logger.error(error.message);
      return null;
    }
    return data as {
      id: string;
      platform: string;
      account_label: string;
      external_account_id: string;
    } | null;
  }

  async getAccountWithMetadata(
    organizationId: string,
    socialAccountId: string,
  ): Promise<{
    id: string;
    platform: string;
    external_account_id: string;
    metadata: Record<string, unknown>;
    status: string;
  }> {
    const db = this.adminClient();
    const { data, error } = await db
      .from('social_accounts')
      .select('id, platform, external_account_id, metadata, status')
      .eq('id', socialAccountId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException('Social account not found.');
    }
    return data as {
      id: string;
      platform: string;
      external_account_id: string;
      metadata: Record<string, unknown>;
      status: string;
    };
  }

  async getDecryptedAccessToken(socialAccountId: string): Promise<string> {
    const { access_token } = await this.loadCredentialsForRefresh(socialAccountId);
    return access_token;
  }
}
