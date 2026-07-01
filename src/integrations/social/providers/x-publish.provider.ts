import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  SocialPublishInput,
  SocialPublishProvider,
  SocialPublishResult,
} from '../interfaces/social-publish-provider.interface';

const TWEETS_URL = 'https://api.twitter.com/2/tweets';

@Injectable()
export class XPublishProvider implements SocialPublishProvider {
  readonly platform = 'x';
  private readonly logger = new Logger(XPublishProvider.name);

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const res = await fetch(TWEETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: input.caption }),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      const detail = json.detail ?? json.title ?? json.error;
      const msg = typeof detail === 'string' ? detail : text.slice(0, 300);
      this.logger.warn(`X publish failed status=${res.status} ${text.slice(0, 500)}`);
      throw new ServiceUnavailableException(`X publish failed (${res.status}): ${msg}`);
    }
    const data = json.data as Record<string, unknown> | undefined;
    const tweetId = typeof data?.id === 'string' ? data.id : null;
    if (!tweetId) {
      throw new ServiceUnavailableException('X publish response missing tweet id.');
    }
    return {
      externalPostId: tweetId,
      externalPostUrl: `https://x.com/i/web/status/${tweetId}`,
      responsePayload: json,
    };
  }
}
