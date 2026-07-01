import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type PromptRow = {
  template_key: string;
  template_text: string;
  prompt_role: string;
  channel: string;
};

@Injectable()
export class SocialPromptComposerService {
  private readonly logger = new Logger(SocialPromptComposerService.name);

  constructor(private readonly config: ConfigService) {}

  private adminClient(): SupabaseClient {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (!url || !(serviceRoleKey || anonKey)) {
      throw new ServiceUnavailableException('Supabase is not configured for social prompts.');
    }
    return createClient(url, serviceRoleKey ?? anonKey!);
  }

  private geminiApiKey(): string | null {
    return this.config.get<string>('gemini.apiKey')?.trim() || null;
  }

  async composeCaption(params: {
    platform: string;
    postKind: string;
    context: Record<string, string>;
    renderTemplateKey?: string;
  }): Promise<string> {
    const result = await this.composeCaptionWithMeta({
      ...params,
      postKind: params.postKind,
    });
    return result.caption;
  }

  async composeCaptionWithMeta(params: {
    platform: string;
    postKind: string;
    context: Record<string, string>;
    renderTemplateKey?: string;
  }): Promise<{ caption: string; resolved_prompt_keys: string[]; render_template_key: string }> {
    const db = this.adminClient();
    const renderKey = params.renderTemplateKey ?? 'signal_card_v1';

    const { data: renderRow, error: renderErr } = await db
      .from('social_render_templates')
      .select('default_prompt_bundle')
      .eq('template_key', renderKey)
      .eq('is_active', true)
      .maybeSingle();
    if (renderErr) {
      this.logger.error(renderErr.message);
      throw new ServiceUnavailableException('Failed to load render template.');
    }

    const bundle = (renderRow?.default_prompt_bundle ?? {}) as Record<string, unknown>;
    const keys = this.resolvePromptKeys(bundle, params.platform, params.postKind);

    const { data: prompts, error: promptErr } = await db
      .from('social_prompt_templates')
      .select('template_key, template_text, prompt_role, channel')
      .in('template_key', keys)
      .eq('is_active', true);
    if (promptErr) {
      this.logger.error(promptErr.message);
      throw new ServiceUnavailableException('Failed to load prompt templates.');
    }

    const ordered = keys
      .map((k) => (prompts as PromptRow[] | null)?.find((p) => p.template_key === k))
      .filter(Boolean) as PromptRow[];

    const systemParts: string[] = [];
    const userParts: string[] = [];
    for (const p of ordered) {
      const text = this.interpolate(p.template_text, params.context);
      if (p.prompt_role === 'guardrail') {
        systemParts.push(text);
      } else {
        userParts.push(text);
      }
    }

    const apiKey = this.geminiApiKey();
    if (!apiKey) {
      return {
        caption: this.fallbackCaption(params.context),
        resolved_prompt_keys: keys,
        render_template_key: renderKey,
      };
    }

    const model = 'models/gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
    const body: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${userParts.join('\n\n')}\n\nWrite the final ${params.platform} caption only.`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    };
    if (systemParts.length) {
      body.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = json.error as { message?: string } | undefined;
      this.logger.warn(`Gemini caption failed: ${err?.message ?? res.status}`);
      return {
        caption: this.fallbackCaption(params.context),
        resolved_prompt_keys: keys,
        render_template_key: renderKey,
      };
    }
    const candidates = json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    const text = candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return {
      caption: text || this.fallbackCaption(params.context),
      resolved_prompt_keys: keys,
      render_template_key: renderKey,
    };
  }

  async composeVideoScriptWithMeta(params: {
    platform: string;
    postKind: string;
    context: Record<string, string>;
    renderTemplateKey?: string;
  }): Promise<{ script_text: string; resolved_prompt_keys: string[]; render_template_key: string }> {
    const { bundle, renderKey } = await this.loadRenderBundle(params.renderTemplateKey);
    const templateKey = this.resolveMediaPromptKey(bundle, 'video_script');
    if (!templateKey) {
      throw new BadRequestException(
        'Selected render script has no video_script prompt configured.',
      );
    }

    const prompt = await this.loadPromptTemplate(templateKey);
    const interpolated = this.interpolate(prompt.template_text, params.context);
    const apiKey = this.geminiApiKey();
    if (!apiKey) {
      return {
        script_text: this.fallbackVideoScript(params.context),
        resolved_prompt_keys: [templateKey],
        render_template_key: renderKey,
      };
    }

    const text = await this.callGeminiText({
      apiKey,
      systemParts: [],
      userParts: [interpolated],
      instruction: `Write the final ${params.platform} video script only.`,
      maxOutputTokens: 768,
    });

    return {
      script_text: text || this.fallbackVideoScript(params.context),
      resolved_prompt_keys: [templateKey],
      render_template_key: renderKey,
    };
  }

  async generateImageWithMeta(params: {
    platform: string;
    postKind: string;
    context: Record<string, string>;
    renderTemplateKey?: string;
  }): Promise<{
    image_buffer: Buffer;
    mime: string;
    image_prompt_text: string;
    resolved_prompt_keys: string[];
    render_template_key: string;
  }> {
    const resolved = await this.resolveImagePromptText({
      context: params.context,
      renderTemplateKey: params.renderTemplateKey,
    });
    const apiKey = this.geminiApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException('GEMINI_API_KEY is not configured for image generation.');
    }

    const generated = await this.callGeminiImage(apiKey, resolved.image_prompt_text);
    return {
      image_buffer: generated.buffer,
      mime: generated.mime,
      image_prompt_text: resolved.image_prompt_text,
      resolved_prompt_keys: resolved.resolved_prompt_keys,
      render_template_key: resolved.render_template_key,
    };
  }

  async resolveImagePromptText(params: {
    context: Record<string, string>;
    renderTemplateKey?: string;
  }): Promise<{
    image_prompt_text: string;
    resolved_prompt_keys: string[];
    render_template_key: string;
  }> {
    const { bundle, renderKey } = await this.loadRenderBundle(params.renderTemplateKey);
    const templateKey = this.resolveMediaPromptKey(bundle, 'image_generation');
    if (!templateKey) {
      throw new BadRequestException(
        'Selected render script has no image_generation prompt configured.',
      );
    }

    const prompt = await this.loadPromptTemplate(templateKey);
    const imagePrompt = this.interpolate(prompt.template_text, params.context);
    return {
      image_prompt_text: imagePrompt,
      resolved_prompt_keys: [templateKey],
      render_template_key: renderKey,
    };
  }

  resolveMediaPromptKey(
    bundle: Record<string, unknown>,
    slot: 'image_generation' | 'video_script',
  ): string | null {
    const key = bundle[slot];
    return typeof key === 'string' ? key : null;
  }

  resolvePromptKeys(bundle: Record<string, unknown>, platform: string, postKind?: string): string[] {
    const keys: string[] = [];
    if (typeof bundle.caption_base === 'string') keys.push(bundle.caption_base);
    if (typeof bundle.post_kind_overlay === 'string') keys.push(bundle.post_kind_overlay);
    const overlays = bundle.platform_overlay;
    if (overlays && typeof overlays === 'object' && !Array.isArray(overlays)) {
      const po = (overlays as Record<string, unknown>)[platform];
      if (typeof po === 'string') keys.push(po);
    }
    if (typeof bundle.guardrail === 'string') keys.push(bundle.guardrail);
    if (!keys.length) {
      keys.push('caption_base_signal_v1', 'guardrail_financial_v1');
    }
    return [...new Set(keys)];
  }

  private async loadRenderBundle(renderTemplateKey?: string): Promise<{
    bundle: Record<string, unknown>;
    renderKey: string;
  }> {
    const db = this.adminClient();
    const renderKey = renderTemplateKey ?? 'signal_card_v1';
    const { data: renderRow, error: renderErr } = await db
      .from('social_render_templates')
      .select('default_prompt_bundle')
      .eq('template_key', renderKey)
      .eq('is_active', true)
      .maybeSingle();
    if (renderErr) {
      this.logger.error(renderErr.message);
      throw new ServiceUnavailableException('Failed to load render template.');
    }
    return {
      bundle: (renderRow?.default_prompt_bundle ?? {}) as Record<string, unknown>,
      renderKey,
    };
  }

  private async loadPromptTemplate(templateKey: string): Promise<PromptRow> {
    const db = this.adminClient();
    const { data, error } = await db
      .from('social_prompt_templates')
      .select('template_key, template_text, prompt_role, channel')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .maybeSingle();
    if (error || !data) {
      throw new BadRequestException(`Prompt template not found: ${templateKey}`);
    }
    return data as PromptRow;
  }

  private async callGeminiText(params: {
    apiKey: string;
    systemParts: string[];
    userParts: string[];
    instruction: string;
    maxOutputTokens: number;
  }): Promise<string | null> {
    const model = 'models/gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${params.apiKey}`;
    const body: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${params.userParts.join('\n\n')}\n\n${params.instruction}` }],
        },
      ],
      generationConfig: { temperature: 0.4, maxOutputTokens: params.maxOutputTokens },
    };
    if (params.systemParts.length) {
      body.systemInstruction = { parts: [{ text: params.systemParts.join('\n\n') }] };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = json.error as { message?: string } | undefined;
      this.logger.warn(`Gemini text failed: ${err?.message ?? res.status}`);
      return null;
    }
    const candidates = json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    return candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  }

  private async callGeminiImage(
    apiKey: string,
    prompt: string,
  ): Promise<{ buffer: Buffer; mime: string }> {
    const models = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview'];
    let lastError: string | null = null;

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: '16:9' },
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const err = json.error as { message?: string } | undefined;
        lastError = err?.message ?? `Image generation failed (${res.status}).`;
        this.logger.warn(`Gemini image model ${model} failed: ${lastError}`);
        continue;
      }

      const candidates = json.candidates as Array<{
        content?: {
          parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }>;
        };
      }> | undefined;

      for (const part of candidates?.[0]?.content?.parts ?? []) {
        const encoded = part.inlineData?.data;
        if (encoded) {
          return {
            buffer: Buffer.from(encoded, 'base64'),
            mime: part.inlineData?.mimeType ?? 'image/png',
          };
        }
      }

      lastError = `Model ${model} returned no image data.`;
      this.logger.warn(lastError);
    }

    throw new BadRequestException(
      lastError ?? 'Image generation failed. Check GEMINI_API_KEY and model access.',
    );
  }

  private interpolate(template: string, context: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => context[key] ?? '');
  }

  private fallbackCaption(context: Record<string, string>): string {
    const ticker = context.ticker?.trim();
    const signal = context.signal_name?.trim() || 'Signal';
    const url = context.page_url?.trim();
    const lines = [
      ticker ? `${ticker}: ${signal}` : signal,
      context.summary?.trim(),
      url,
      'Not investment advice. Do your own research.',
    ].filter(Boolean);
    return lines.join('\n\n');
  }

  private fallbackVideoScript(context: Record<string, string>): string {
    const ticker = context.ticker?.trim();
    const signal = context.signal_name?.trim() || 'Signal';
    const url = context.page_url?.trim();
    return [
      `[HOOK] ${ticker ? `What is ${ticker} insiders seeing?` : 'What are insiders seeing?'}`,
      `[BODY] ${context.summary?.trim() || signal}`,
      `[CTA] Full details: ${url ?? 'link in bio'}`,
      'Not investment advice.',
    ].join('\n\n');
  }
}
