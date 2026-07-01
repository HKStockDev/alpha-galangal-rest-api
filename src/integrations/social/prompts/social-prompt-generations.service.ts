import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type GenerationKind = 'caption' | 'image_prompt' | 'video_script';
export type GenerationProvider = 'gemini' | 'manual' | 'woop_dashboard';
export type GenerationStatus = 'text_only' | 'media_linked' | 'published';

export type CreateGenerationParams = {
  organizationId: string;
  userId?: string;
  generationKind: GenerationKind;
  renderTemplateKey?: string;
  platform?: string;
  postKind?: string;
  context: Record<string, unknown>;
  outputText: string;
  resolvedPromptKeys: string[];
  provider?: GenerationProvider;
  woopMediaId?: string;
  status?: GenerationStatus;
};

@Injectable()
export class SocialPromptGenerationsService {
  private readonly logger = new Logger(SocialPromptGenerationsService.name);

  constructor(private readonly config: ConfigService) {}

  private db(): SupabaseClient {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (!url || !(serviceRoleKey || anonKey)) {
      throw new ServiceUnavailableException('Supabase is not configured for social generations.');
    }
    return createClient(url, serviceRoleKey ?? anonKey!);
  }

  async create(params: CreateGenerationParams) {
    const status =
      params.status ??
      (params.woopMediaId ? 'media_linked' : 'text_only');

    const { data, error } = await this.db()
      .from('social_prompt_generations')
      .insert({
        organization_id: params.organizationId,
        generation_kind: params.generationKind,
        render_template_key: params.renderTemplateKey ?? null,
        platform: params.platform ?? null,
        post_kind: params.postKind ?? null,
        context: params.context,
        output_text: params.outputText,
        resolved_prompt_keys: params.resolvedPromptKeys,
        provider: params.provider ?? 'gemini',
        woop_media_id: params.woopMediaId ?? null,
        status,
        created_by_user_id: params.userId ?? null,
      })
      .select('*')
      .single();

    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to save generation history.');
    }
    return data;
  }

  async list(filters: {
    organizationId: string;
    generationKind?: GenerationKind;
    renderTemplateKey?: string;
    limit?: number;
  }) {
    let q = this.db()
      .from('social_prompt_generations')
      .select('*')
      .eq('organization_id', filters.organizationId)
      .order('created_at', { ascending: false });

    if (filters.generationKind) {
      q = q.eq('generation_kind', filters.generationKind);
    }
    if (filters.renderTemplateKey) {
      q = q.eq('render_template_key', filters.renderTemplateKey);
    }
    const limit = Math.min(filters.limit ?? 100, 200);
    q = q.limit(limit);

    const { data, error } = await q;
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to list generation history.');
    }
    return data ?? [];
  }

  async getById(id: string, organizationId: string) {
    const { data, error } = await this.db()
      .from('social_prompt_generations')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException('Generation record not found.');
    }
    return data;
  }

  async linkWoopMedia(id: string, organizationId: string, woopMediaId: string) {
    await this.getById(id, organizationId);
    const { data, error } = await this.db()
      .from('social_prompt_generations')
      .update({
        woop_media_id: woopMediaId,
        status: 'media_linked',
      })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('*')
      .single();
    if (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to link Woop media.');
    }
    return data;
  }
}
