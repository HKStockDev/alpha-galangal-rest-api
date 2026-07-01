import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FacebookOauthProvider } from './providers/facebook-oauth.provider';
import { FacebookPublishProvider } from './providers/facebook-publish.provider';
import { InstagramOauthProvider } from './providers/instagram-oauth.provider';
import { LinkedinOauthProvider } from './providers/linkedin-oauth.provider';
import { LinkedinPublishProvider } from './providers/linkedin-publish.provider';
import { TiktokOauthProvider } from './providers/tiktok-oauth.provider';
import { XPublishProvider } from './providers/x-publish.provider';
import { XOauthProvider } from './providers/x-oauth.provider';
import { SocialAccountsService } from './social-accounts.service';
import { SocialOauthAdminController } from './social-oauth-admin.controller';
import { SocialOauthRegistryService } from './social-oauth-registry.service';
import { SocialOauthService } from './social-oauth.service';
import { SocialOauthStateService } from './social-oauth-state.service';
import { SocialPostsAdminController } from './social-posts-admin.controller';
import { SocialPostsService } from './social-posts.service';
import { SocialPromptComposerService } from './social-prompt-composer.service';
import { SocialPublishRegistryService } from './social-publish-registry.service';
import { SocialPublishService } from './social-publish.service';
import {
  WoopSocialAdminController,
  WoopSocialClient,
  WoopSocialService,
  WoopWebhookController,
} from './woop';
import { SocialPromptGenerationsService } from './prompts/social-prompt-generations.service';
import { SocialPromptTemplatesService } from './prompts/social-prompt-templates.service';
import { SocialRenderTemplatesService } from './prompts/social-render-templates.service';
import { SocialPromptsAdminController } from './prompts/social-prompts-admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    SocialOauthAdminController,
    SocialPostsAdminController,
    SocialPromptsAdminController,
    WoopSocialAdminController,
    WoopWebhookController,
  ],
  providers: [
    FacebookOauthProvider,
    InstagramOauthProvider,
    LinkedinOauthProvider,
    XOauthProvider,
    TiktokOauthProvider,
    FacebookPublishProvider,
    LinkedinPublishProvider,
    XPublishProvider,
    SocialOauthRegistryService,
    SocialPublishRegistryService,
    SocialOauthStateService,
    WoopSocialClient,
    WoopSocialService,
    SocialPromptTemplatesService,
    SocialPromptGenerationsService,
    SocialRenderTemplatesService,
    SocialAccountsService,
    SocialOauthService,
    SocialPromptComposerService,
    SocialPublishService,
    SocialPostsService,
  ],
  exports: [SocialOauthService, SocialAccountsService, SocialPostsService, SocialPublishService],
})
export class IntegrationsSocialModule {}
