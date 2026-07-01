import type { SocialOauthPlatform } from '../constants';
import { convictionPlatformToWoop } from './woop-platform.util';

export type WoopPostSchedule =
  | { type: 'PUBLISH_NOW' }
  | { type: 'SCHEDULE_FOR_LATER'; scheduledFor: string }
  | { type: 'DRAFT' };

export type BuildWoopPostPayloadParams = {
  socialAccountId: string;
  woopPlatform: string;
  caption: string;
  linkUrl?: string | null;
  mediaIds?: string[];
  platformInputs?: Record<string, unknown>;
  postKind?: string;
  schedule?: WoopPostSchedule;
};

/** Woop CreatePostRequest social account targets that do not accept postType. */
const WOOP_TARGETS_WITHOUT_POST_TYPE = new Set([
  'X',
  'LINKEDIN',
  'LINKEDIN_PAGES',
  'THREADS',
]);

export function postKindToWoopPostType(postKind: string, hasMedia: boolean): string | undefined {
  if (hasMedia) {
    if (postKind === 'video' || postKind === 'reel') return 'VIDEO';
    return 'IMAGE';
  }
  if (postKind === 'link_share') return 'LINK';
  return undefined;
}

export function publishModeToWoopSchedule(
  mode: 'now' | 'schedule' | 'draft',
  publishAt?: string,
): WoopPostSchedule {
  if (mode === 'draft') return { type: 'DRAFT' };
  if (mode === 'schedule' && publishAt) {
    return { type: 'SCHEDULE_FOR_LATER', scheduledFor: publishAt };
  }
  return { type: 'PUBLISH_NOW' };
}

export function buildWoopPostPayload(params: BuildWoopPostPayloadParams): Record<string, unknown> {
  let text = params.caption.trim();
  if (params.linkUrl?.trim() && !text.includes(params.linkUrl.trim())) {
    text = `${text}\n\n${params.linkUrl.trim()}`;
  }

  const hasMedia = (params.mediaIds?.length ?? 0) > 0;
  const postType = postKindToWoopPostType(params.postKind ?? 'text', hasMedia);

  const target: Record<string, unknown> = {
    socialAccountId: params.socialAccountId,
    platform: params.woopPlatform,
    ...(params.platformInputs ?? {}),
  };
  if (postType && !WOOP_TARGETS_WITHOUT_POST_TYPE.has(params.woopPlatform)) {
    target.postType = postType;
  }

  const contentItem: Record<string, unknown> = { text };
  if (hasMedia) {
    contentItem.media = params.mediaIds!.map((mediaId) => ({
      type: 'MEDIA_LIBRARY',
      mediaId,
    }));
  }

  return {
    socialAccounts: [target],
    content: [contentItem],
    schedule: params.schedule ?? { type: 'PUBLISH_NOW' },
  };
}

export function convictionPlatformToWoopSafe(platform: string): string {
  return convictionPlatformToWoop(platform as SocialOauthPlatform);
}
