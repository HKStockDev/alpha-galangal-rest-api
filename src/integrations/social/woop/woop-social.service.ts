import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SocialOauthPlatform } from '../constants';
import { WoopSocialClient } from './woop-social.client';
import {
  buildWoopPostPayload,
  type WoopPostSchedule,
  convictionPlatformToWoopSafe,
} from './woop-post-payload.util';
import {
  convictionPlatformToWoop,
  woopPlatformToConviction,
  woopStatusToConviction,
  type WoopSocialPlatform,
} from './woop-platform.util';
import { unwrapWoopList } from './woop-response.util';

export type WoopSocialAccountDto = {
  id: string;
  externalAccountId: string;
  platform: string;
  username: string;
  imageUrl: string;
  status: string;
};

type WoopProject = { id: string; name: string };

type MappedSocialAccountRow = {
  id: string;
  organization_id: string;
  platform: string;
  account_label: string | null;
  external_account_name: string | null;
  external_account_id: string | null;
  status: string;
  metadata: Record<string, unknown>;
  last_successful_publish_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  social_account_credentials: null;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class WoopSocialService {
  private cachedProjectId: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly client: WoopSocialClient,
  ) {}

  isEnabled(): boolean {
    return this.client.isEnabled();
  }

  private organizationId(): string {
    const id = this.config.get<string>('social.convictionOrganizationId')?.trim();
    if (!id) {
      throw new BadRequestException(
        'Set CONVICTION_ORGANIZATION_ID on the API server for Woop Social integration.',
      );
    }
    return id;
  }

  async resolveProjectId(): Promise<string> {
    const fromEnv = this.config.get<string>('woopSocial.projectId')?.trim();
    if (fromEnv) {
      this.cachedProjectId = fromEnv;
      return fromEnv;
    }
    if (this.cachedProjectId) {
      return this.cachedProjectId;
    }

    const projects = await this.client.get<WoopProject[]>('/projects');
    if (projects.length > 0) {
      this.cachedProjectId = projects[0].id;
      return projects[0].id;
    }

    const name =
      this.config.get<string>('woopSocial.defaultProjectName')?.trim() ?? 'Conviction';
    const created = await this.client.post<WoopProject>('/projects', { name });
    this.cachedProjectId = created.id;
    return created.id;
  }

  private mapAccount(account: WoopSocialAccountDto): MappedSocialAccountRow {
    const now = new Date().toISOString();
    return {
      id: account.id,
      organization_id: this.organizationId(),
      platform: woopPlatformToConviction(account.platform),
      account_label: account.username || null,
      external_account_name: account.username || null,
      external_account_id: account.externalAccountId || null,
      status: woopStatusToConviction(account.status),
      metadata: {
        woop: true,
        image_url: account.imageUrl,
        woop_platform: account.platform,
      },
      last_successful_publish_at: null,
      last_error_at: null,
      last_error_message: null,
      social_account_credentials: null,
      created_at: now,
      updated_at: now,
    };
  }

  async listAccounts(): Promise<MappedSocialAccountRow[]> {
    const projectId = await this.resolveProjectId();
    const accounts = await this.client.get<WoopSocialAccountDto[]>('/social-accounts', {
      projectId,
    });
    return accounts.map((a) => this.mapAccount(a));
  }

  async createAuthorizationUrl(params: {
    platform: SocialOauthPlatform;
    redirectUrl: string;
  }): Promise<{ url: string; redirect_uri: string }> {
    const projectId = await this.resolveProjectId();
    const woopPlatform = convictionPlatformToWoop(params.platform);
    const response = await this.client.post<{ url: string }>(
      '/social-accounts/authorization-url',
      {
        projectId,
        platform: woopPlatform as WoopSocialPlatform,
        redirectUrl: params.redirectUrl,
      },
    );
    return { url: response.url, redirect_uri: params.redirectUrl };
  }

  async deleteAccount(socialAccountId: string): Promise<void> {
    await this.client.delete(`/social-accounts/${encodeURIComponent(socialAccountId)}`);
  }

  parseWoopPlatformFromCallback(raw: string | null | undefined): SocialOauthPlatform | null {
    if (!raw?.trim()) return null;
    const normalized = woopPlatformToConviction(raw);
    const allowed: SocialOauthPlatform[] = [
      'facebook',
      'instagram',
      'linkedin',
      'x',
      'tiktok',
    ];
    return (allowed as readonly string[]).includes(normalized)
      ? (normalized as SocialOauthPlatform)
      : null;
  }

  async getPlatformInputs(socialAccountId: string): Promise<unknown> {
    return this.client.get(
      `/social-accounts/${encodeURIComponent(socialAccountId)}/platform-inputs`,
    );
  }

  async buildPostPayload(params: {
    socialAccountId: string;
    caption: string;
    linkUrl?: string | null;
    mediaIds?: string[];
    platformInputs?: Record<string, unknown>;
    postKind?: string;
    schedule?: WoopPostSchedule;
  }): Promise<Record<string, unknown>> {
    const accounts = await this.listAccounts();
    const account = accounts.find((a) => a.id === params.socialAccountId);
    if (!account) {
      throw new BadRequestException('Woop social account not found.');
    }
    const woopPlatform = convictionPlatformToWoopSafe(account.platform);
    return buildWoopPostPayload({
      socialAccountId: params.socialAccountId,
      woopPlatform,
      caption: params.caption,
      linkUrl: params.linkUrl,
      mediaIds: params.mediaIds,
      platformInputs: params.platformInputs,
      postKind: params.postKind,
      schedule: params.schedule,
    });
  }

  async validatePostPayload(params: {
    socialAccountId: string;
    caption: string;
    linkUrl?: string | null;
    mediaIds?: string[];
    platformInputs?: Record<string, unknown>;
    postKind?: string;
    schedule?: WoopPostSchedule;
  }): Promise<unknown> {
    const payload = await this.buildPostPayload(params);
    return this.client.post('/posts/validate', payload);
  }

  async validatePost(payload: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/posts/validate', payload);
  }

  async createPost(params: {
    socialAccountId: string;
    caption: string;
    linkUrl?: string | null;
    mediaIds?: string[];
    platformInputs?: Record<string, unknown>;
    postKind?: string;
    schedule?: WoopPostSchedule;
  }): Promise<{ woopPostId: string; externalPostId?: string; externalPostUrl?: string }> {
    const payload = await this.buildPostPayload(params);
    const created = await this.client.post<{
      id: string;
      socialAccountPosts?: Array<{ id: string; externalPostUrl?: string; externalPostId?: string }>;
    }>('/posts', payload);
    const child = created.socialAccountPosts?.[0];
    return {
      woopPostId: created.id,
      externalPostId: child?.externalPostId,
      externalPostUrl: child?.externalPostUrl,
    };
  }

  async getPost(postId: string): Promise<unknown> {
    return this.client.get(`/posts/${encodeURIComponent(postId)}`);
  }

  async deletePost(postId: string): Promise<void> {
    await this.client.delete(`/posts/${encodeURIComponent(postId)}`);
  }

  async listSocialAccountPosts(query?: Record<string, string | undefined>): Promise<unknown[]> {
    const projectId = await this.resolveProjectId();
    const payload = await this.client.get<unknown>('/social-account-posts', {
      projectId,
      ...query,
    });
    return unwrapWoopList(payload, 'socialAccountPosts');
  }

  async listMedia(query?: Record<string, string | undefined>): Promise<unknown[]> {
    const projectId = await this.resolveProjectId();
    const payload = await this.client.get<unknown>('/media', { projectId, ...query });
    return unwrapWoopList(payload, 'media');
  }

  async createMediaUploadSession(fileSizeInBytes: number): Promise<unknown> {
    const projectId = await this.resolveProjectId();
    return this.client.post('/media/upload-sessions', { projectId, fileSizeInBytes });
  }

  async getMediaUploadSession(uploadSessionId: string): Promise<unknown> {
    return this.client.get(`/media/upload-sessions/${encodeURIComponent(uploadSessionId)}`);
  }

  async completeMediaUploadSession(uploadSessionId: string): Promise<unknown> {
    return this.client.post(`/media/upload-sessions/${encodeURIComponent(uploadSessionId)}/complete`);
  }

  async deleteMedia(mediaId: string): Promise<void> {
    await this.client.delete(`/media/${encodeURIComponent(mediaId)}`);
  }

  async uploadMediaBuffer(
    buffer: Buffer,
    mime: string,
    filename: string,
  ): Promise<{ mediaId: string }> {
    const projectId = await this.resolveProjectId();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
    const result = await this.client.postFormData<{ mediaId: string }>('/media', form, {
      projectId,
    });
    if (!result?.mediaId) {
      throw new BadRequestException('Woop media upload did not return a mediaId.');
    }
    return result;
  }

  async listWebhooks(): Promise<unknown[]> {
    const payload = await this.client.get<unknown>('/webhooks/endpoints');
    return unwrapWoopList(payload, 'endpoints');
  }

  async createWebhook(url: string, eventTypes: string[]): Promise<unknown> {
    return this.client.post('/webhooks/endpoints', { url, eventTypes });
  }

  async deleteWebhook(endpointId: string): Promise<void> {
    await this.client.delete(`/webhooks/endpoints/${encodeURIComponent(endpointId)}`);
  }
}
