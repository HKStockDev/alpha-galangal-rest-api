import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  SocialPublishInput,
  SocialPublishProvider,
  SocialPublishResult,
} from '../interfaces/social-publish-provider.interface';

const POSTS_URL = 'https://api.linkedin.com/rest/posts';

@Injectable()
export class LinkedinPublishProvider implements SocialPublishProvider {
  readonly platform = 'linkedin';
  private readonly logger = new Logger(LinkedinPublishProvider.name);

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const meta = input.accountMetadata ?? {};
    const orgUrn =
      typeof meta.linkedin_organization_urn === 'string'
        ? meta.linkedin_organization_urn
        : null;
    const resourceType =
      typeof meta.linkedin_resource_type === 'string' ? meta.linkedin_resource_type : 'member';

    let author: string;
    if (resourceType === 'organization' && orgUrn) {
      author = orgUrn;
    } else {
      author = `urn:li:person:${input.externalAccountId}`;
    }

    const hasLink = Boolean(input.linkUrl?.trim());
    const body: Record<string, unknown> = {
      author,
      commentary: input.caption,
      visibility: 'PUBLIC',
      lifecycleState: 'PUBLISHED',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
    };

    if (hasLink) {
      body.content = {
        article: {
          source: input.linkUrl!.trim(),
          title: input.caption.split('\n')[0]?.slice(0, 200) || 'Shared link',
        },
      };
    } else {
      body.content = { media: { title: input.caption.slice(0, 200) } };
    }

    const res = await fetch(POSTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202401',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      const msg =
        typeof json.message === 'string'
          ? json.message
          : typeof json.status === 'number'
            ? text.slice(0, 300)
            : text.slice(0, 300);
      this.logger.warn(`LinkedIn publish failed status=${res.status} ${text.slice(0, 500)}`);
      throw new ServiceUnavailableException(`LinkedIn publish failed (${res.status}): ${msg}`);
    }
    const postUrn =
      (typeof json.id === 'string' ? json.id : null) ||
      res.headers.get('x-restli-id') ||
      res.headers.get('x-linkedin-id');
    if (!postUrn) {
      throw new ServiceUnavailableException('LinkedIn publish response missing post id.');
    }
    return {
      externalPostId: postUrn,
      externalPostUrl: null,
      providerRequestId: postUrn,
      responsePayload: json,
    };
  }
}
