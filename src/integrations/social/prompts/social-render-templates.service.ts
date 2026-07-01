import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CreateRenderTemplateDto, UpdateRenderTemplateDto } from './dto/social-prompts.dto';
import { SocialPromptTemplatesService } from './social-prompt-templates.service';

@Injectable()
export class SocialRenderTemplatesService {
  private readonly logger = new Logger(SocialRenderTemplatesService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prompts: SocialPromptTemplatesService,
  ) {}

  private db(): SupabaseClient {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (!url || !(serviceRoleKey || anonKey)) {
      throw new ServiceUnavailableException('Supabase is not configured.');
    }
    return createClient(url, serviceRoleKey ?? anonKey!);
  }

  async list() {
    const { data, error } = await this.db()
      .from('social_render_templates')
      .select('*')
      .order('template_key');
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to list render templates.');
    }
    return data ?? [];
  }

  async getByKey(templateKey: string) {
    const { data: render, error } = await this.db()
      .from('social_render_templates')
      .select('*')
      .eq('template_key', templateKey)
      .maybeSingle();
    if (error || !render) {
      throw new NotFoundException('Render template not found.');
    }

    const { data: links } = await this.db()
      .from('social_render_template_prompts')
      .select('slot, sort_order, social_prompt_templates ( id, template_key, prompt_role, channel, purpose )')
      .eq('render_template_key', templateKey)
      .order('sort_order');

    const bundle = (render as { default_prompt_bundle?: Record<string, unknown> })
      .default_prompt_bundle ?? {};
    const keys = this.prompts.collectKeysFromBundle(bundle);
    let resolvedPrompts: unknown[] = [];
    if (keys.length) {
      const { data: promptRows } = await this.db()
        .from('social_prompt_templates')
        .select('id, template_key, prompt_role, channel, post_kind, purpose, template_text, is_active')
        .in('template_key', keys);
      resolvedPrompts = keys
        .map((k) => (promptRows ?? []).find((p) => (p as { template_key: string }).template_key === k))
        .filter(Boolean);
    }

    return { ...render, slot_links: links ?? [], resolved_prompts: resolvedPrompts };
  }

  async create(dto: CreateRenderTemplateDto) {
    const keys = this.prompts.collectKeysFromBundle(dto.default_prompt_bundle);
    await this.prompts.assertTemplateKeysExist(keys);

    const { data, error } = await this.db()
      .from('social_render_templates')
      .insert({
        template_key: dto.template_key.trim(),
        display_name: dto.display_name,
        description: dto.description ?? null,
        renderer: dto.renderer ?? 'code_registry_v1',
        compatible_post_kinds: dto.compatible_post_kinds ?? ['link_share'],
        default_prompt_bundle: dto.default_prompt_bundle,
        is_active: true,
      })
      .select('*')
      .single();
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException(error.message || 'Failed to create render template.');
    }
    return data;
  }

  async update(templateKey: string, dto: UpdateRenderTemplateDto) {
    await this.getByKey(templateKey);
    if (dto.default_prompt_bundle) {
      const keys = this.prompts.collectKeysFromBundle(dto.default_prompt_bundle);
      await this.prompts.assertTemplateKeysExist(keys);
    }
    const patch: Record<string, unknown> = {};
    if (dto.display_name !== undefined) patch.display_name = dto.display_name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.compatible_post_kinds !== undefined) {
      patch.compatible_post_kinds = dto.compatible_post_kinds;
    }
    if (dto.default_prompt_bundle !== undefined) {
      patch.default_prompt_bundle = dto.default_prompt_bundle;
    }
    if (dto.is_active !== undefined) patch.is_active = dto.is_active;

    const { data, error } = await this.db()
      .from('social_render_templates')
      .update(patch)
      .eq('template_key', templateKey)
      .select('*')
      .single();
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to update render template.');
    }
    return data;
  }
}
