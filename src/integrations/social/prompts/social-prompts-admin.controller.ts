import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseAuthGuard } from '../../../auth/guards/supabase-auth.guard';
import { PlatformAdminGuard } from '../../../auth/guards/platform-admin.guard';
import { resolvePrecisionOrganizationId } from '../social-org.util';
import { SocialPromptComposerService } from '../social-prompt-composer.service';
import { WoopSocialService } from '../woop/woop-social.service';
import {
  CreatePromptTemplateDto,
  CreateRenderTemplateDto,
  GenerateMediaDto,
  ListPromptGenerationsQueryDto,
  ListPromptTemplatesQueryDto,
  PreviewImagePromptDto,
  PromptPreviewDto,
  UpdatePromptGenerationDto,
  UpdatePromptTemplateDto,
  UpdateRenderTemplateDto,
} from './dto/social-prompts.dto';
import { SocialPromptGenerationsService } from './social-prompt-generations.service';
import { SocialPromptTemplatesService } from './social-prompt-templates.service';
import { SocialRenderTemplatesService } from './social-render-templates.service';

type AuthedRequest = { user?: { sub?: string; id?: string } };

@Controller('admin/integrations/social/prompts')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class SocialPromptsAdminController {
  constructor(
    private readonly config: ConfigService,
    private readonly templates: SocialPromptTemplatesService,
    private readonly renderTemplates: SocialRenderTemplatesService,
    private readonly composer: SocialPromptComposerService,
    private readonly generations: SocialPromptGenerationsService,
    private readonly woop: WoopSocialService,
  ) {}

  private orgId(): string {
    return resolvePrecisionOrganizationId(this.config);
  }

  private userId(req: AuthedRequest): string | undefined {
    return req.user?.sub ?? req.user?.id;
  }

  @Get('templates')
  listTemplates(@Query() query: ListPromptTemplatesQueryDto) {
    return this.templates.list({
      channel: query.channel,
      post_kind: query.post_kind,
      purpose: query.purpose,
      prompt_role: query.prompt_role,
      is_active: query.is_active,
    });
  }

  @Get('templates/:id')
  getTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.getById(id);
  }

  @Post('templates')
  createTemplate(@Body() body: CreatePromptTemplateDto) {
    return this.templates.create(body);
  }

  @Patch('templates/:id')
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePromptTemplateDto,
  ) {
    return this.templates.update(id, body);
  }

  @Delete('templates/:id')
  deleteTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.softDelete(id);
  }

  @Get('render-templates')
  listRenderTemplates() {
    return this.renderTemplates.list();
  }

  @Get('render-templates/:key')
  getRenderTemplate(@Param('key') key: string) {
    return this.renderTemplates.getByKey(key);
  }

  @Post('render-templates')
  createRenderTemplate(@Body() body: CreateRenderTemplateDto) {
    return this.renderTemplates.create(body);
  }

  @Patch('render-templates/:key')
  updateRenderTemplate(@Param('key') key: string, @Body() body: UpdateRenderTemplateDto) {
    return this.renderTemplates.update(key, body);
  }

  @Get('generations')
  listGenerations(@Query() query: ListPromptGenerationsQueryDto) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.generations.list({
      organizationId: this.orgId(),
      generationKind: query.kind,
      renderTemplateKey: query.render_template_key,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  }

  @Get('generations/:id')
  getGeneration(@Param('id', ParseUUIDPipe) id: string) {
    return this.generations.getById(id, this.orgId());
  }

  @Patch('generations/:id')
  patchGeneration(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePromptGenerationDto,
  ) {
    if (body.woop_media_id) {
      return this.generations.linkWoopMedia(id, this.orgId(), body.woop_media_id);
    }
    throw new BadRequestException('woop_media_id is required to update a generation.');
  }

  @Post('preview-image-prompt')
  async previewImagePrompt(@Body() body: PreviewImagePromptDto, @Req() req: AuthedRequest) {
    const resolved = await this.composer.resolveImagePromptText({
      context: body.context,
      renderTemplateKey: body.render_template_key,
    });
    const row = await this.generations.create({
      organizationId: this.orgId(),
      userId: this.userId(req),
      generationKind: 'image_prompt',
      renderTemplateKey: resolved.render_template_key,
      context: body.context,
      outputText: resolved.image_prompt_text,
      resolvedPromptKeys: resolved.resolved_prompt_keys,
      provider: 'gemini',
    });
    return {
      image_prompt_text: resolved.image_prompt_text,
      resolved_prompt_keys: resolved.resolved_prompt_keys,
      render_template_key: resolved.render_template_key,
      generation_id: row.id,
    };
  }

  @Post('preview')
  async preview(@Body() body: PromptPreviewDto, @Req() req: AuthedRequest) {
    const result = await this.composer.composeCaptionWithMeta({
      platform: body.platform,
      postKind: body.post_kind ?? 'link_share',
      context: body.context,
      renderTemplateKey: body.render_template_key,
    });
    const row = await this.generations.create({
      organizationId: this.orgId(),
      userId: this.userId(req),
      generationKind: 'caption',
      renderTemplateKey: result.render_template_key,
      platform: body.platform,
      postKind: body.post_kind ?? 'link_share',
      context: body.context,
      outputText: result.caption,
      resolvedPromptKeys: result.resolved_prompt_keys,
      provider: 'gemini',
    });
    return { ...result, generation_id: row.id };
  }

  @Post('generate-media')
  async generateMedia(@Body() body: GenerateMediaDto, @Req() req: AuthedRequest) {
    if (body.media_kind === 'video_script') {
      const result = await this.composer.composeVideoScriptWithMeta({
        platform: body.platform,
        postKind: body.post_kind ?? 'video',
        context: body.context,
        renderTemplateKey: body.render_template_key,
      });
      const row = await this.generations.create({
        organizationId: this.orgId(),
        userId: this.userId(req),
        generationKind: 'video_script',
        renderTemplateKey: result.render_template_key,
        platform: body.platform,
        postKind: body.post_kind ?? 'video',
        context: body.context,
        outputText: result.script_text,
        resolvedPromptKeys: result.resolved_prompt_keys,
        provider: 'gemini',
      });
      return { ...result, generation_id: row.id };
    }

    if (!this.woop.isEnabled()) {
      throw new ServiceUnavailableException('WOOP_SOCIAL_API_KEY is not configured.');
    }

    const generated = await this.composer.generateImageWithMeta({
      platform: body.platform,
      postKind: body.post_kind ?? 'single_image',
      context: body.context,
      renderTemplateKey: body.render_template_key,
    });

    const ext = generated.mime.includes('jpeg') ? 'jpg' : 'png';
    const uploaded = await this.woop.uploadMediaBuffer(
      generated.image_buffer,
      generated.mime,
      `signal-card-${Date.now()}.${ext}`,
    );

    const row = await this.generations.create({
      organizationId: this.orgId(),
      userId: this.userId(req),
      generationKind: 'image_prompt',
      renderTemplateKey: generated.render_template_key,
      platform: body.platform,
      postKind: body.post_kind ?? 'single_image',
      context: body.context,
      outputText: generated.image_prompt_text,
      resolvedPromptKeys: generated.resolved_prompt_keys,
      provider: 'gemini',
      woopMediaId: uploaded.mediaId,
      status: 'media_linked',
    });

    return {
      woop_media_id: uploaded.mediaId,
      mime: generated.mime,
      image_prompt_text: generated.image_prompt_text,
      resolved_prompt_keys: generated.resolved_prompt_keys,
      render_template_key: generated.render_template_key,
      generation_id: row.id,
    };
  }
}
