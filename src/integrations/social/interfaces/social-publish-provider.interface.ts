export type SocialPublishInput = {
  accessToken: string;
  externalAccountId: string;
  caption: string;
  linkUrl?: string | null;
  postKind: string;
  accountMetadata?: Record<string, unknown>;
};

export type SocialPublishResult = {
  externalPostId: string;
  externalPostUrl?: string | null;
  providerRequestId?: string | null;
  responsePayload?: Record<string, unknown>;
};

export interface SocialPublishProvider {
  readonly platform: string;
  publish(input: SocialPublishInput): Promise<SocialPublishResult>;
}
