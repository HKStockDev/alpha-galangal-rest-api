import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SocialAccountsService } from './social-accounts.service';
import { SocialPromptComposerService } from './social-prompt-composer.service';
import { SocialPublishService } from './social-publish.service';
import { WoopSocialService } from './woop/woop-social.service';
import { woopPlatformToPrecision } from './woop/woop-platform.util';
import { defaultPostKindForPlatform, isMvpPublishPlatform } from './social-org.util';

const DAILY_POST_LIMIT = 3;

@Injectable()
export class SocialPostsService {
  private readonly logger = new Logger(SocialPostsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly accounts: SocialAccountsService,
    private readonly promptComposer: SocialPromptComposerService,
    private readonly publish: SocialPublishService,
    private readonly woop: WoopSocialService,
  ) {}

  private adminClient(): SupabaseClient {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (!url || !(serviceRoleKey || anonKey)) {
      throw new ServiceUnavailableException('Supabase is not configured.');
    }
    return createClient(url, serviceRoleKey ?? anonKey!);
  }

  async previewCaption(params: {
    organizationId: string;
    platform: string;
    linkUrl: string;
    shareTitle: string;
    shareSummary?: string;
    ticker?: string;
    organizationName?: string;
    postKind?: string;
    renderTemplateKey?: string;
  }) {
    if (!this.woop.isEnabled() && !isMvpPublishPlatform(params.platform)) {
      throw new BadRequestException(
        `Preview publish is only supported for facebook, linkedin, x (got "${params.platform}").`,
      );
    }
    const postKind = params.postKind ?? defaultPostKindForPlatform(params.platform);
    const context = this.buildPromptContext(params);
    const caption = await this.promptComposer.composeCaption({
      platform: params.platform,
      postKind,
      context,
      renderTemplateKey: params.renderTemplateKey,
    });
    const account = await this.accounts.findActiveAccountForPlatform(
      params.organizationId,
      params.platform,
    );
    return {
      platform: params.platform,
      post_kind: postKind,
      caption,
      link_url: params.linkUrl,
      suggested_social_account_id: account?.id ?? null,
    };
  }

  async createDraft(params: {
    organizationId: string;
    userId?: string;
    socialAccountId: string;
    caption: string;
    linkUrl?: string;
    postKind?: string;
    promptParams?: Record<string, unknown>;
    mediaIds?: string[];
    publishMode?: 'now' | 'schedule' | 'draft';
    publishAt?: string;
    status?: 'draft' | 'scheduled';
  }) {
    const account = await this.accounts.getAccountForOrg(params.organizationId, params.socialAccountId);
    if (!this.woop.isEnabled() && !isMvpPublishPlatform(account.platform)) {
      throw new BadRequestException(`Publishing to ${account.platform} is not enabled in MVP.`);
    }
    const postKind = params.postKind ?? defaultPostKindForPlatform(account.platform);
    if (params.linkUrl?.trim()) {
      await this.assertNotDuplicate(params.organizationId, account.platform, params.linkUrl.trim());
    }
    if (params.publishMode !== 'draft') {
      await this.assertRateLimit(params.organizationId, account.platform);
    }

    const promptParams = this.mergePromptParams({
      promptParams: params.promptParams,
      mediaIds: params.mediaIds,
      publishMode: params.publishMode,
      publishAt: params.publishAt,
      woopSocialAccountId: account.woop_social_account_id,
    });

    const status = params.status ?? 'draft';
    const db = this.adminClient();
    const { data, error } = await db
      .from('social_posts')
      .insert({
        organization_id: params.organizationId,
        social_account_id: account.id,
        post_kind: postKind,
        status,
        caption: params.caption,
        link_url: params.linkUrl?.trim() || null,
        publish_at: params.publishAt ?? null,
        art_template_key:
          (promptParams.render_template_key as string | undefined) ?? 'signal_card_v1',
        prompt_params: promptParams,
        created_by_user_id: params.userId ?? null,
        updated_by_user_id: params.userId ?? null,
      })
      .select('id, status, post_kind, caption, link_url, publish_at')
      .single();
    if (error || !data) {
      this.logger.error(error?.message);
      throw new BadRequestException('Failed to create social post draft.');
    }
    return data;
  }

  async publishPost(params: {
    organizationId: string;
    socialPostId: string;
    userId?: string;
  }) {
    const db = this.adminClient();
    const { data: post, error } = await db
      .from('social_posts')
      .select('id, organization_id, social_account_id, post_kind, status, caption, link_url, prompt_params')
      .eq('id', params.socialPostId)
      .eq('organization_id', params.organizationId)
      .maybeSingle();
    if (error || !post) {
      throw new NotFoundException('Social post not found.');
    }
    const row = post as Record<string, unknown>;
    const status = String(row.status ?? '');
    if (status === 'published') {
      throw new BadRequestException('Post is already published.');
    }
    if (status === 'cancelled') {
      throw new BadRequestException('Post was cancelled.');
    }

    try {
      const account = await this.accounts.getAccountForOrg(
        params.organizationId,
        String(row.social_account_id),
      );
      const platform = account.platform;
      if (!this.woop.isEnabled() && !isMvpPublishPlatform(platform)) {
        throw new BadRequestException(`Publishing to ${platform} is not enabled in MVP.`);
      }

      const promptParams = (row.prompt_params as Record<string, unknown>) ?? {};

      const linkUrl = typeof row.link_url === 'string' ? row.link_url : null;
      if (linkUrl) {
        await this.assertNotDuplicate(params.organizationId, platform, linkUrl, params.socialPostId);
      }
      await this.assertRateLimit(params.organizationId, platform);

      await db
        .from('social_posts')
        .update({ status: 'publishing', updated_by_user_id: params.userId ?? null })
        .eq('id', params.socialPostId);

      const result = await this.publish.publishPost({
        socialAccountId: String(row.social_account_id),
        platform,
        externalAccountId: String(account.external_account_id),
        accountMetadata: promptParams,
        caption: String(row.caption ?? ''),
        linkUrl,
        postKind: String(row.post_kind ?? 'text'),
        socialPostId: params.socialPostId,
      });

      const publishMode = (promptParams.woop_publish_mode as string | undefined) ?? 'now';
      const isScheduled = publishMode === 'schedule';
      const publishAt =
        typeof promptParams.woop_schedule_at === 'string'
          ? promptParams.woop_schedule_at
          : null;

      await db
        .from('social_posts')
        .update({
          status: isScheduled ? 'scheduled' : 'published',
          published_at: isScheduled ? null : new Date().toISOString(),
          publish_at: isScheduled ? publishAt : null,
          external_post_id: isScheduled ? null : result.externalPostId,
          external_post_url: isScheduled ? null : result.externalPostUrl,
          last_error_message: null,
          updated_by_user_id: params.userId ?? null,
          prompt_params: {
            ...promptParams,
            woop_post_id: result.providerRequestId ?? promptParams.woop_post_id,
          },
        })
        .eq('id', params.socialPostId);

      if (!this.woop.isEnabled() && !isScheduled) {
        await db
          .from('social_accounts')
          .update({ last_successful_publish_at: new Date().toISOString() })
          .eq('id', String(row.social_account_id));
      }

      return {
        id: params.socialPostId,
        status: isScheduled ? 'scheduled' : 'published',
        external_post_id: result.externalPostId,
        external_post_url: result.externalPostUrl,
        publish_at: publishAt,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Publish failed';
      await db
        .from('social_posts')
        .update({
          status: 'failed',
          last_error_message: msg,
          updated_by_user_id: params.userId ?? null,
        })
        .eq('id', params.socialPostId);
      throw e;
    }
  }

  async createAndPublish(params: {
    organizationId: string;
    userId?: string;
    socialAccountId: string;
    caption: string;
    linkUrl?: string;
    postKind?: string;
    promptParams?: Record<string, unknown>;
    publishMode?: 'now' | 'schedule' | 'draft';
    publishAt?: string;
    mediaIds?: string[];
  }) {
    const publishMode = params.publishMode ?? 'now';

    if (publishMode === 'schedule' && !params.publishAt) {
      throw new BadRequestException('publish_at is required when publish_mode is schedule.');
    }
    if (publishMode === 'schedule') {
      const at = new Date(params.publishAt!);
      if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
        throw new BadRequestException('publish_at must be a future UTC datetime.');
      }
    }

    if (publishMode === 'draft') {
      return this.createDraft({
        ...params,
        publishMode: 'draft',
        status: 'draft',
      });
    }

    const account = await this.accounts.getAccountForOrg(
      params.organizationId,
      params.socialAccountId,
    );
    const reusableDraftId = await this.findReusableDraftId({
      organizationId: params.organizationId,
      socialAccountId: account.id,
      platform: account.platform,
      linkUrl: params.linkUrl?.trim(),
    });
    if (reusableDraftId) {
      return this.publishPost({
        organizationId: params.organizationId,
        socialPostId: reusableDraftId,
        userId: params.userId,
      });
    }

    const draft = await this.createDraft({
      ...params,
      publishMode,
      publishAt: params.publishAt,
      status: publishMode === 'schedule' ? 'scheduled' : 'draft',
    });
    const id = (draft as { id: string }).id;
    return this.publishPost({
      organizationId: params.organizationId,
      socialPostId: id,
      userId: params.userId,
    });
  }

  private mergePromptParams(params: {
    promptParams?: Record<string, unknown>;
    mediaIds?: string[];
    publishMode?: 'now' | 'schedule' | 'draft';
    publishAt?: string;
    woopSocialAccountId?: string;
  }): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...(params.promptParams ?? {}) };
    if (params.mediaIds?.length) {
      merged.woop_media_ids = params.mediaIds;
    }
    if (params.publishMode) {
      merged.woop_publish_mode = params.publishMode;
    }
    if (params.publishAt) {
      merged.woop_schedule_at = params.publishAt;
    }
    if (params.woopSocialAccountId) {
      merged.woop_social_account_id = params.woopSocialAccountId;
    }
    return merged;
  }

  async listRecent(organizationId: string, limit = 25) {
    if (this.woop.isEnabled()) {
      const woopPosts = await this.woop.listSocialAccountPosts({ limit: String(limit) });
      return (woopPosts as Array<Record<string, unknown>>).map((p) => ({
        id: String(p.id ?? p.socialAccountPostId ?? ''),
        post_kind: 'link_share',
        status: String(p.deliveryStatus ?? p.status ?? 'unknown').toLowerCase(),
        caption: String((p.content as { text?: string })?.text ?? p.text ?? ''),
        link_url: null,
        published_at: p.publishedAt ?? p.published_at ?? null,
        external_post_url: p.externalPostUrl ?? p.external_post_url ?? null,
        last_error_message: p.lastErrorMessage ?? p.last_error_message ?? null,
        created_at: p.createdAt ?? p.created_at ?? new Date().toISOString(),
        social_accounts: {
          platform: woopPlatformToPrecision(String(p.platform ?? '')),
          account_label: p.username ?? null,
        },
        source: 'woop',
      }));
    }

    const db = this.adminClient();
    const { data, error } = await db
      .from('social_posts')
      .select(
        'id, post_kind, status, caption, link_url, published_at, publish_at, external_post_url, last_error_message, created_at, social_accounts ( platform, account_label )',
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to list social posts.');
    }
    return data ?? [];
  }

  private buildPromptContext(params: {
    linkUrl: string;
    shareTitle: string;
    shareSummary?: string;
    ticker?: string;
    organizationName?: string;
  }): Record<string, string> {
    return {
      page_url: params.linkUrl,
      signal_name: params.shareTitle,
      summary: params.shareSummary?.trim() || params.shareTitle,
      ticker: params.ticker?.trim() || '',
      organization_name: params.organizationName?.trim() || 'Precision',
    };
  }

  private async assertRateLimit(organizationId: string, platform: string): Promise<void> {
    const db = this.adminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from('social_posts')
      .select('id, social_accounts!inner(platform)')
      .eq('organization_id', organizationId)
      .gte('created_at', since)
      .in('status', ['published', 'publishing', 'scheduled']);
    if (error) {
      this.logger.warn(error.message);
      return;
    }
    const count = (data ?? []).filter((row) => {
      const acc = (row as { social_accounts?: { platform?: string } }).social_accounts;
      return acc?.platform === platform;
    }).length;
    if (count >= DAILY_POST_LIMIT) {
      throw new BadRequestException(
        `Rate limit: max ${DAILY_POST_LIMIT} posts per platform per 24h (${platform}).`,
      );
    }
  }

  private async assertNotDuplicate(
    organizationId: string,
    platform: string,
    linkUrl: string,
    excludePostId?: string,
  ): Promise<void> {
    const db = this.adminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let q = db
      .from('social_posts')
      .select('id, social_accounts!inner(platform)')
      .eq('organization_id', organizationId)
      .eq('link_url', linkUrl)
      .gte('created_at', since)
      .in('status', ['published', 'publishing', 'scheduled', 'draft']);
    if (excludePostId) {
      q = q.neq('id', excludePostId);
    }
    const { data, error } = await q;
    if (error) {
      this.logger.warn(error.message);
      return;
    }
    const dup = (data ?? []).some((row) => {
      const acc = (row as { social_accounts?: { platform?: string } }).social_accounts;
      return acc?.platform === platform;
    });
    if (dup) {
      throw new BadRequestException(
        `This link was already shared to ${platform} within the last 24 hours. ` +
          'If a previous publish failed, retry from Post history or use a different link.',
      );
    }
  }

  /** Re-publish an orphaned draft when the user retries the same link on the same account. */
  private async findReusableDraftId(params: {
    organizationId: string;
    socialAccountId: string;
    platform: string;
    linkUrl?: string;
  }): Promise<string | null> {
    if (!params.linkUrl) return null;
    const db = this.adminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from('social_posts')
      .select('id, social_accounts!inner(platform)')
      .eq('organization_id', params.organizationId)
      .eq('social_account_id', params.socialAccountId)
      .eq('link_url', params.linkUrl)
      .eq('status', 'draft')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      this.logger.warn(error.message);
      return null;
    }
    const row = (data ?? []).find((r) => {
      const acc = (r as { social_accounts?: { platform?: string } }).social_accounts;
      return acc?.platform === params.platform;
    }) as { id?: string } | undefined;
    return row?.id ? String(row.id) : null;
  }
}
