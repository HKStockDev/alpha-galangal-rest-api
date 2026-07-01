import { BadRequestException, Injectable } from '@nestjs/common';
import { FacebookOauthProvider } from './providers/facebook-oauth.provider';
import { InstagramOauthProvider } from './providers/instagram-oauth.provider';
import { LinkedinOauthProvider } from './providers/linkedin-oauth.provider';
import { TiktokOauthProvider } from './providers/tiktok-oauth.provider';
import { XOauthProvider } from './providers/x-oauth.provider';
import type { SocialOauthPlatform } from './constants';
import type { SocialOauthProvider } from './interfaces/social-oauth-provider.interface';

@Injectable()
export class SocialOauthRegistryService {
  constructor(
    private readonly facebook: FacebookOauthProvider,
    private readonly instagram: InstagramOauthProvider,
    private readonly linkedin: LinkedinOauthProvider,
    private readonly x: XOauthProvider,
    private readonly tiktok: TiktokOauthProvider,
  ) {}

  getProvider(platform: SocialOauthPlatform): SocialOauthProvider {
    switch (platform) {
      case 'facebook':
        return this.facebook;
      case 'instagram':
        return this.instagram;
      case 'linkedin':
        return this.linkedin;
      case 'x':
        return this.x;
      case 'tiktok':
        return this.tiktok;
      default:
        throw new BadRequestException(`OAuth for platform "${platform}" is not implemented yet.`);
    }
  }
}
