import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CreatePromptTemplateDto, UpdatePromptTemplateDto } from './dto/social-prompts.dto';

@Injectable()
export class SocialPromptTemplatesService {
  private readonly logger = new Logger(SocialPromptTemplatesService.name);

  constructor(private readonly config: ConfigService) {}

  private db(): SupabaseClient {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (!url || !(serviceRoleKey || anonKey)) {
      throw new ServiceUnavailableException('Supabase is not configured for social prompts.');
    }
    return createClient(url, serviceRoleKey ?? anonKey!);
  }

  async list(filters: {
    channel?: string;
    post_kind?: string;
    purpose?: string;
    prompt_role?: string;
    is_active?: boolean;
  }) {
    let q = this.db()
      .from('social_prompt_templates')
      .select('*')
      .order('prompt_role')
      .order('template_key');
    if (filters.channel) q = q.eq('channel', filters.channel);
    if (filters.post_kind) q = q.eq('post_kind', filters.post_kind);
    if (filters.purpose) q = q.eq('purpose', filters.purpose);
    if (filters.prompt_role) q = q.eq('prompt_role', filters.prompt_role);
    if (filters.is_active !== undefined) q = q.eq('is_active', filters.is_active);
    const { data, error } = await q;
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to list prompt templates.');
    }
    return data ?? [];
  }

  async getById(id: string) {
    const { data, error } = await this.db()
      .from('social_prompt_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException('Prompt template not found.');
    }
    return data;
  }

  async create(dto: CreatePromptTemplateDto) {
    const { data, error } = await this.db()
      .from('social_prompt_templates')
      .insert({
        template_key: dto.template_key.trim(),
        channel: dto.channel ?? 'all',
        post_kind: dto.post_kind ?? 'all',
        purpose: dto.purpose,
        prompt_role: dto.prompt_role,
        template_text: dto.template_text,
        required_context_keys: dto.required_context_keys ?? [],
        change_note: dto.change_note ?? null,
        is_active: true,
      })
      .select('*')
      .single();
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException(error.message || 'Failed to create prompt template.');
    }
    return data;
  }

  async update(id: string, dto: UpdatePromptTemplateDto) {
    const current = await this.getById(id);
    const patch: Record<string, unknown> = {};
    if (dto.channel !== undefined) patch.channel = dto.channel;
    if (dto.post_kind !== undefined) patch.post_kind = dto.post_kind;
    if (dto.purpose !== undefined) patch.purpose = dto.purpose;
    if (dto.prompt_role !== undefined) patch.prompt_role = dto.prompt_role;
    if (dto.template_text !== undefined) patch.template_text = dto.template_text;
    if (dto.required_context_keys !== undefined) {
      patch.required_context_keys = dto.required_context_keys;
    }
    if (dto.is_active !== undefined) patch.is_active = dto.is_active;
    if (dto.change_note !== undefined) patch.change_note = dto.change_note;
    if (Object.keys(patch).length) {
      const prevVersion = (current as { version?: number }).version ?? 1;
      patch.version = prevVersion + 1;
    }
    const { data, error } = await this.db()
      .from('social_prompt_templates')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to update prompt template.');
    }
    return data;
  }

  async softDelete(id: string) {
    return this.update(id, { is_active: false, change_note: 'Deactivated via admin' });
  }

  async assertTemplateKeysExist(keys: string[]): Promise<void> {
    if (!keys.length) return;
    const { data, error } = await this.db()
      .from('social_prompt_templates')
      .select('template_key')
      .in('template_key', keys)
      .eq('is_active', true);
    if (error) {
      throw new BadRequestException('Failed to validate prompt template keys.');
    }
    const found = new Set((data ?? []).map((r) => (r as { template_key: string }).template_key));
    const missing = keys.filter((k) => !found.has(k));
    if (missing.length) {
      throw new BadRequestException(`Unknown prompt template keys: ${missing.join(', ')}`);
    }
  }

  collectKeysFromBundle(bundle: Record<string, unknown>): string[] {
    const keys: string[] = [];
    if (typeof bundle.caption_base === 'string') keys.push(bundle.caption_base);
    if (typeof bundle.post_kind_overlay === 'string') keys.push(bundle.post_kind_overlay);
    if (typeof bundle.guardrail === 'string') keys.push(bundle.guardrail);
    if (typeof bundle.image_generation === 'string') keys.push(bundle.image_generation);
    if (typeof bundle.video_script === 'string') keys.push(bundle.video_script);
    const overlays = bundle.platform_overlay;
    if (overlays && typeof overlays === 'object' && !Array.isArray(overlays)) {
      for (const v of Object.values(overlays as Record<string, unknown>)) {
        if (typeof v === 'string') keys.push(v);
      }
    }
    return [...new Set(keys)];
  }
}
