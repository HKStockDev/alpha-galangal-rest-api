import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SocialAccountsService } from './social-accounts.service';
import { SocialPublishRegistryService } from './social-publish-registry.service';
import { WoopSocialService } from './woop/woop-social.service';
import { publishModeToWoopSchedule } from './woop/woop-post-payload.util';

@Injectable()
export class SocialPublishService {
  private readonly logger = new Logger(SocialPublishService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SocialPublishRegistryService,
    private readonly accounts: SocialAccountsService,
    private readonly woop: WoopSocialService,
  ) {}

  private adminClient(): SupabaseClient {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    return createClient(url!, serviceRoleKey ?? anonKey!);
  }

  async publishPost(params: {
    socialPostId: string;
    socialAccountId: string;
    platform: string;
    externalAccountId: string;
    accountMetadata: Record<string, unknown>;
    caption: string;
    linkUrl?: string | null;
    postKind: string;
  }) {
    const db = this.adminClient();
    const { count } = await db
      .from('social_publish_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('social_post_id', params.socialPostId);
    const attemptNumber = (count ?? 0) + 1;

    const { data: attemptRow } = await db
      .from('social_publish_attempts')
      .insert({
        social_post_id: params.socialPostId,
        attempt_number: attemptNumber,
        status: 'started',
        request_payload: {
          platform: params.platform,
          post_kind: params.postKind,
          link_url: params.linkUrl,
        },
      })
      .select('id')
      .single();

    try {
      if (this.woop.isEnabled()) {
        const woopAccountId =
          (params.accountMetadata.woop_social_account_id as string | undefined) ??
          params.socialAccountId;
        const publishMode =
          (params.accountMetadata.woop_publish_mode as 'now' | 'schedule' | 'draft' | undefined) ??
          'now';
        const scheduleAt = params.accountMetadata.woop_schedule_at as string | undefined;
        const schedule = publishModeToWoopSchedule(publishMode, scheduleAt);

        const result = await this.woop.createPost({
          socialAccountId: woopAccountId,
          caption: params.caption,
          linkUrl: params.linkUrl,
          mediaIds: (params.accountMetadata.woop_media_ids as string[] | undefined) ?? [],
          platformInputs:
            (params.accountMetadata.woop_platform_inputs as Record<string, unknown>) ?? {},
          postKind: params.postKind,
          schedule,
        });
        if (attemptRow?.id) {
          await db
            .from('social_publish_attempts')
            .update({
              status: 'succeeded',
              finished_at: new Date().toISOString(),
              external_post_id: result.externalPostId ?? result.woopPostId,
              provider_request_id: result.woopPostId,
              response_payload: result,
            })
            .eq('id', attemptRow.id);
        }
        return {
          externalPostId: result.externalPostId ?? result.woopPostId,
          externalPostUrl: result.externalPostUrl,
          providerRequestId: result.woopPostId,
          responsePayload: result,
        };
      }

      const accessToken = await this.accounts.getDecryptedAccessToken(params.socialAccountId);
      const provider = this.registry.getProvider(params.platform);
      const result = await provider.publish({
        accessToken,
        externalAccountId: params.externalAccountId,
        caption: params.caption,
        linkUrl: params.linkUrl,
        postKind: params.postKind,
        accountMetadata: params.accountMetadata,
      });

      if (attemptRow?.id) {
        await db
          .from('social_publish_attempts')
          .update({
            status: 'succeeded',
            finished_at: new Date().toISOString(),
            external_post_id: result.externalPostId,
            provider_request_id: result.providerRequestId ?? null,
            response_payload: result.responsePayload ?? {},
          })
          .eq('id', attemptRow.id);
      }

      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Publish failed';
      if (attemptRow?.id) {
        await db
          .from('social_publish_attempts')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            error_message: msg,
          })
          .eq('id', attemptRow.id);
      }
      throw e;
    }
  }
}
