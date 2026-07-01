import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseAuthGuard } from '../../auth/guards/supabase-auth.guard';
import { PlatformAdminGuard } from '../../auth/guards/platform-admin.guard';
import {
  CreateSocialPostDto,
  PublishSocialPostDto,
  SocialPostPreviewDto,
} from './dto/social-posts.dto';
import { SocialPostsService } from './social-posts.service';
import { resolveConvictionOrganizationId } from './social-org.util';

type AuthedRequest = { user?: { sub?: string; id?: string } };

/**
 * CON-167: Connect sharing with connected social accounts (preview → draft → publish).
 */
@Controller('admin/integrations/social/posts')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class SocialPostsAdminController {
  constructor(
    private readonly config: ConfigService,
    private readonly posts: SocialPostsService,
  ) {}

  private orgId(explicit?: string): string {
    return resolveConvictionOrganizationId(this.config, explicit);
  }

  private userId(req: AuthedRequest): string | undefined {
    return req.user?.sub ?? req.user?.id;
  }

  @Post('preview')
  preview(@Body() body: SocialPostPreviewDto) {
    return this.posts.previewCaption({
      organizationId: this.orgId(body.organization_id),
      platform: body.platform,
      linkUrl: body.link_url,
      shareTitle: body.share_title,
      shareSummary: body.share_summary,
      ticker: body.ticker,
      organizationName: body.organization_name,
      postKind: body.post_kind,
      renderTemplateKey: body.render_template_key,
    });
  }

  @Post()
  async create(@Body() body: CreateSocialPostDto, @Req() req: AuthedRequest) {
    const organizationId = this.orgId(body.organization_id);
    const userId = this.userId(req);
    const publishMode = body.publish_mode ?? (body.publish === false ? 'draft' : 'now');

    if (body.publish !== false && publishMode !== 'draft') {
      return this.posts.createAndPublish({
        organizationId,
        userId,
        socialAccountId: body.social_account_id,
        caption: body.caption,
        linkUrl: body.link_url,
        postKind: body.post_kind,
        promptParams: body.prompt_params,
        publishMode,
        publishAt: body.publish_at,
        mediaIds: body.media_ids,
      });
    }
    return this.posts.createDraft({
      organizationId,
      userId,
      socialAccountId: body.social_account_id,
      caption: body.caption,
      linkUrl: body.link_url,
      postKind: body.post_kind,
      promptParams: body.prompt_params,
      publishMode: 'draft',
      mediaIds: body.media_ids,
    });
  }

  @Post(':socialPostId/publish')
  publish(
    @Param('socialPostId') socialPostId: string,
    @Body() body: PublishSocialPostDto,
    @Req() req: AuthedRequest,
  ) {
    return this.posts.publishPost({
      organizationId: this.orgId(body.organization_id),
      socialPostId,
      userId: this.userId(req),
    });
  }

  @Get()
  list(@Query('organization_id') organizationIdParam?: string) {
    return this.posts.listRecent(this.orgId(organizationIdParam));
  }
}
