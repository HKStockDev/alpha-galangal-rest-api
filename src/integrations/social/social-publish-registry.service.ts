import { BadRequestException, Injectable } from '@nestjs/common';
import { FacebookPublishProvider } from './providers/facebook-publish.provider';
import { LinkedinPublishProvider } from './providers/linkedin-publish.provider';
import { XPublishProvider } from './providers/x-publish.provider';
import type { SocialPublishProvider } from './interfaces/social-publish-provider.interface';
import { isMvpPublishPlatform } from './social-org.util';

@Injectable()
export class SocialPublishRegistryService {
  constructor(
    private readonly facebook: FacebookPublishProvider,
    private readonly linkedin: LinkedinPublishProvider,
    private readonly x: XPublishProvider,
  ) {}

  getProvider(platform: string): SocialPublishProvider {
    if (!isMvpPublishPlatform(platform)) {
      throw new BadRequestException(
        `Automated publish is not enabled for "${platform}" yet. MVP: facebook, linkedin, x.`,
      );
    }
    switch (platform) {
      case 'facebook':
        return this.facebook;
      case 'linkedin':
        return this.linkedin;
      case 'x':
        return this.x;
      default:
        throw new BadRequestException(`Publish provider for "${platform}" is not implemented.`);
    }
  }
}
