import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../auth/guards/supabase-auth.guard';
import { PlatformAdminGuard } from '../../../auth/guards/platform-admin.guard';
import { WoopSocialService } from './woop-social.service';
import { ValidateWoopComposeDto } from '../dto/validate-woop-compose.dto';
import { publishModeToWoopSchedule } from './woop-post-payload.util';

@Controller('admin/integrations/social/woop')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class WoopSocialAdminController {
  constructor(private readonly woop: WoopSocialService) {}

  private assertWoop() {
    if (!this.woop.isEnabled()) {
      throw new BadRequestException('WOOP_SOCIAL_API_KEY is not configured.');
    }
  }

  @Get('social-account-posts')
  listSocialAccountPosts(@Query() query: Record<string, string | undefined>) {
    this.assertWoop();
    return this.woop.listSocialAccountPosts(query);
  }

  @Get('accounts/:socialAccountId/platform-inputs')
  getPlatformInputs(@Param('socialAccountId') socialAccountId: string) {
    this.assertWoop();
    return this.woop.getPlatformInputs(socialAccountId);
  }

  @Post('posts/validate')
  validatePost(@Body() body: Record<string, unknown>) {
    this.assertWoop();
    return this.woop.validatePost(body);
  }

  @Post('posts/validate-compose')
  validateCompose(@Body() body: ValidateWoopComposeDto) {
    this.assertWoop();
    const publishMode = body.publish_mode ?? 'now';
    return this.woop.validatePostPayload({
      socialAccountId: body.social_account_id,
      caption: body.caption,
      linkUrl: body.link_url,
      mediaIds: body.media_ids,
      platformInputs: body.platform_inputs,
      postKind: body.post_kind,
      schedule: publishModeToWoopSchedule(publishMode, body.publish_at),
    });
  }

  @Get('media')
  listMedia(@Query() query: Record<string, string | undefined>) {
    this.assertWoop();
    return this.woop.listMedia(query);
  }

  @Post('media/upload-sessions')
  createUploadSession(@Body() body: { fileSizeInBytes: number }) {
    this.assertWoop();
    return this.woop.createMediaUploadSession(body.fileSizeInBytes);
  }

  @Get('media/upload-sessions/:id')
  getUploadSession(@Param('id') id: string) {
    this.assertWoop();
    return this.woop.getMediaUploadSession(id);
  }

  @Post('media/upload-sessions/:id/complete')
  completeUploadSession(@Param('id') id: string) {
    this.assertWoop();
    return this.woop.completeMediaUploadSession(id);
  }

  @Delete('media/:mediaId')
  deleteMedia(@Param('mediaId') mediaId: string) {
    this.assertWoop();
    return this.woop.deleteMedia(mediaId);
  }

  @Get('webhooks')
  listWebhooks() {
    this.assertWoop();
    return this.woop.listWebhooks();
  }

  @Post('webhooks')
  createWebhook(@Body() body: { url: string; eventTypes: string[] }) {
    this.assertWoop();
    return this.woop.createWebhook(body.url, body.eventTypes);
  }

  @Delete('webhooks/:endpointId')
  deleteWebhook(@Param('endpointId') endpointId: string) {
    this.assertWoop();
    return this.woop.deleteWebhook(endpointId);
  }
}
