import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SocialPublishInput,
  SocialPublishProvider,
  SocialPublishResult,
} from '../interfaces/social-publish-provider.interface';
import { metaGraphBase } from './meta-oauth.shared';

@Injectable()
export class FacebookPublishProvider implements SocialPublishProvider {
  readonly platform = 'facebook';
  private readonly logger = new Logger(FacebookPublishProvider.name);

  constructor(private readonly config: ConfigService) {}

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const pageId = input.externalAccountId;
    const u = new URL(`${metaGraphBase(this.config)}/${pageId}/feed`);
    u.searchParams.set('access_token', input.accessToken);
    const body: Record<string, string> = { message: input.caption };
    if (input.linkUrl?.trim()) {
      body.link = input.linkUrl.trim();
    }
    const res = await fetch(u.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      const err = json.error as Record<string, unknown> | undefined;
      const msg =
        (typeof err?.message === 'string' ? err.message : '') || text.slice(0, 300);
      this.logger.warn(`Facebook publish failed status=${res.status} ${text.slice(0, 500)}`);
      throw new ServiceUnavailableException(`Facebook publish failed (${res.status}): ${msg}`);
    }
    const postId = typeof json.id === 'string' ? json.id : null;
    if (!postId) {
      throw new ServiceUnavailableException('Facebook publish response missing post id.');
    }
    return {
      externalPostId: postId,
      externalPostUrl: `https://www.facebook.com/${postId}`,
      responsePayload: json,
    };
  }
}
