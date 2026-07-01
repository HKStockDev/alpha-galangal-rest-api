import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MVP_ALL_TOOL_KEYS } from './assistant.constants';

export type RegisteredTool = {
  tool_key: string;
  capability_key: string;
  display_name: string;
  description: string;
  input_schema_json: Record<string, unknown>;
  timeout_ms: number | null;
};

@Injectable()
export class AssistantToolRegistryService {
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private supabase(): SupabaseClient {
    if (!this.adminClient) {
      throw new BadRequestException('Service unavailable');
    }
    return this.adminClient;
  }

  toolKeyToGeminiName(toolKey: string): string {
    return toolKey.replace(/\./g, '_');
  }

  geminiNameToToolKey(name: string): string {
    for (const key of MVP_ALL_TOOL_KEYS) {
      if (this.toolKeyToGeminiName(key) === name) return key;
    }
    throw new BadRequestException(`Unknown function: ${name}`);
  }

  async loadMvpTools(): Promise<RegisteredTool[]> {
    const { data, error } = await this.supabase()
      .from('ai_tools')
      .select(
        'tool_key, capability_key, display_name, description, input_schema_json, timeout_ms',
      )
      .in('tool_key', [...MVP_ALL_TOOL_KEYS])
      .eq('is_enabled', true);

    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data ?? []) as RegisteredTool[];
  }
}
