import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface ContentCategoryRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ContentCategoriesService {
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private requireClient(): SupabaseClient {
    if (!this.adminClient) {
      throw new ServiceUnavailableException('Supabase is not configured.');
    }
    return this.adminClient;
  }

  private normalizeKey(raw: string): string {
    const v = raw.trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(v)) {
      throw new BadRequestException(
        'key must contain only lowercase letters, numbers, and underscores',
      );
    }
    return v;
  }

  async listCategories(input?: {
    includeInactive?: boolean;
  }): Promise<ContentCategoryRow[]> {
    const client = this.requireClient();
    let q = client
      .from('content_categories')
      .select('id, key, label, description, is_active, sort_order, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true });
    if (!input?.includeInactive) {
      q = q.eq('is_active', true);
    }
    const { data, error } = await q;
    if (error) {
      throw new InternalServerErrorException(`content_categories list failed: ${error.message}`);
    }
    return (data ?? []) as ContentCategoryRow[];
  }

  async createCategory(input: {
    key: string;
    label: string;
    description?: string | null;
    is_active?: boolean;
    sort_order?: number;
  }): Promise<ContentCategoryRow> {
    const client = this.requireClient();
    const key = this.normalizeKey(input.key);
    const label = input.label?.trim();
    if (!label) {
      throw new BadRequestException('label is required');
    }
    const payload = {
      key,
      label,
      description: input.description?.trim() || null,
      is_active: input.is_active ?? true,
      sort_order: Number.isFinite(input.sort_order) ? Math.trunc(input.sort_order!) : 0,
    };
    const { data, error } = await client
      .from('content_categories')
      .insert(payload)
      .select('id, key, label, description, is_active, sort_order, created_at, updated_at')
      .single();
    if (error) {
      throw new InternalServerErrorException(`content_categories create failed: ${error.message}`);
    }
    return data as ContentCategoryRow;
  }

  async updateCategory(
    id: string,
    input: {
      key?: string;
      label?: string;
      description?: string | null;
      is_active?: boolean;
      sort_order?: number;
    },
  ): Promise<ContentCategoryRow> {
    const client = this.requireClient();
    const updates: Record<string, unknown> = {};
    if (input.key !== undefined) updates.key = this.normalizeKey(input.key);
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) throw new BadRequestException('label cannot be empty');
      updates.label = label;
    }
    if (input.description !== undefined) {
      updates.description = input.description?.trim() || null;
    }
    if (input.is_active !== undefined) updates.is_active = input.is_active;
    if (input.sort_order !== undefined) updates.sort_order = Math.trunc(input.sort_order);
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No fields to update');
    }
    const { data, error } = await client
      .from('content_categories')
      .update(updates)
      .eq('id', id)
      .select('id, key, label, description, is_active, sort_order, created_at, updated_at')
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(`content_categories update failed: ${error.message}`);
    }
    if (!data) {
      throw new BadRequestException('content category not found');
    }
    return data as ContentCategoryRow;
  }

  async assertCategoryAllowed(category: string | null): Promise<void> {
    if (!category) return;
    const client = this.requireClient();
    const key = category.trim().toLowerCase();
    const { data, error } = await client
      .from('content_categories')
      .select('id')
      .eq('key', key)
      .eq('is_active', true)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(`content_categories validate failed: ${error.message}`);
    }
    if (!data?.id) {
      throw new BadRequestException(`category "${category}" is not an active content category`);
    }
  }
}

