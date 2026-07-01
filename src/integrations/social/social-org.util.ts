import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export function resolvePrecisionOrganizationId(
  config: ConfigService,
  explicit?: string,
): string {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  const fromEnv = config.get<string>('social.precisionOrganizationId')?.trim();
  if (!fromEnv) {
    throw new BadRequestException(
      'Set PRECISION_ORGANIZATION_ID on the API server, or pass organization_id as a query/body parameter.',
    );
  }
  return fromEnv;
}

/** MVP post_kind per platform (CON-108). */
export function defaultPostKindForPlatform(platform: string): 'link_share' | 'text' | 'single_image' {
  if (platform === 'facebook') return 'link_share';
  if (platform === 'linkedin') return 'link_share';
  if (platform === 'x') return 'link_share';
  if (platform === 'instagram') return 'single_image';
  return 'text';
}

export const MVP_PUBLISH_PLATFORMS = ['facebook', 'linkedin', 'x'] as const;
export type MvpPublishPlatform = (typeof MVP_PUBLISH_PLATFORMS)[number];

export function isMvpPublishPlatform(platform: string): platform is MvpPublishPlatform {
  return (MVP_PUBLISH_PLATFORMS as readonly string[]).includes(platform);
}
