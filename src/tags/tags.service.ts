import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CreateTagDto, UpdateTagDto } from './dto';

const TAG_BASE_SELECT =
  'tag_id, name, slug, group, description, is_active, is_llm_assignable, sort_order, weight_hint, organization_id, visibility, marketing_slug, hero_image_url, marketing_settings, created_at, updated_at';

const TAG_LIST_SELECT = `${TAG_BASE_SELECT}, organizations(name, slug)`;

const DEFAULT_ORG_SLUG = 'default-organization';

export interface TagRow {
  tag_id: string;
  name: string;
  slug: string;
  group: string;
  description: string | null;
  is_active: boolean;
  is_llm_assignable: boolean;
  sort_order: number | null;
  weight_hint: number | null;
  organization_id: string;
  organization_name: string | null;
  organization_slug: string | null;
  visibility: string;
  marketing_slug: string | null;
  hero_image_url: string | null;
  marketing_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

type TagListRow = {
  tag_id: string;
  name: string;
  slug: string;
  group: string;
  description: string | null;
  is_active: boolean;
  is_llm_assignable: boolean;
  sort_order: number | null;
  weight_hint: number | null;
  organization_id: string;
  visibility: string;
  marketing_slug: string | null;
  hero_image_url: string | null;
  marketing_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  organizations?: { name: string; slug: string } | null;
};

@Injectable()
export class TagsService {
  private adminClient: SupabaseClient | null = null;
  private defaultOrganizationId: string | null = null;

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

  private mapListRow(row: TagListRow): TagRow {
    const org = row.organizations;
    return {
      tag_id: row.tag_id,
      name: row.name,
      slug: row.slug,
      group: row.group,
      description: row.description,
      is_active: row.is_active,
      is_llm_assignable: row.is_llm_assignable,
      sort_order: row.sort_order,
      weight_hint: row.weight_hint,
      organization_id: row.organization_id,
      organization_name: org?.name ?? null,
      organization_slug: org?.slug ?? null,
      visibility: row.visibility ?? 'internal',
      marketing_slug: row.marketing_slug ?? null,
      hero_image_url: row.hero_image_url ?? null,
      marketing_settings: row.marketing_settings ?? {},
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private async resolveDefaultOrganizationId(): Promise<string> {
    if (this.defaultOrganizationId) {
      return this.defaultOrganizationId;
    }
    const client = this.requireClient();
    const { data, error } = await client
      .from('organizations')
      .select('id')
      .eq('slug', DEFAULT_ORG_SLUG)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data?.id) {
      throw new BadRequestException(
        `No organization with slug "${DEFAULT_ORG_SLUG}" exists; cannot create tags without organization_id.`,
      );
    }
    this.defaultOrganizationId = data.id;
    return data.id;
  }

  async list(activeOnly?: boolean, llmAssignableOnly?: boolean): Promise<TagRow[]> {
    const client = this.requireClient();
    let q = client.from('tags').select(TAG_LIST_SELECT).order('sort_order', { ascending: true, nullsFirst: false });
    q = q.order('name', { ascending: true });
    if (activeOnly) {
      q = q.eq('is_active', true);
    }
    if (llmAssignableOnly) {
      q = q.eq('is_llm_assignable', true);
    }
    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(error.message);
    }
    return ((data ?? []) as unknown as TagListRow[]).map((r) => this.mapListRow(r));
  }

  async getById(tagId: string): Promise<TagRow> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('tags')
      .select(TAG_LIST_SELECT)
      .eq('tag_id', tagId)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Tag not found');
    }
    return this.mapListRow(data as unknown as TagListRow);
  }

  async create(dto: CreateTagDto): Promise<TagRow> {
    const client = this.requireClient();
    const slug = dto.slug.trim().toLowerCase();
    const organizationId = dto.organization_id ?? (await this.resolveDefaultOrganizationId());
    const insert = {
      name: dto.name.trim(),
      slug,
      group: dto.group.trim(),
      description: dto.description ?? null,
      is_active: dto.is_active ?? true,
      is_llm_assignable: dto.is_llm_assignable ?? true,
      sort_order: dto.sort_order ?? null,
      weight_hint: dto.weight_hint ?? null,
      organization_id: organizationId,
    };
    const { data, error } = await client.from('tags').insert(insert).select(TAG_LIST_SELECT).single();
    if (error) {
      if (error.code === '23505' || error.message.includes('duplicate')) {
        throw new ConflictException('A tag with this name or slug already exists');
      }
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new BadRequestException('Insert failed');
    }
    return this.mapListRow(data as unknown as TagListRow);
  }

  async update(tagId: string, dto: UpdateTagDto): Promise<TagRow> {
    const client = this.requireClient();
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.slug !== undefined) updates.slug = dto.slug.trim().toLowerCase();
    if (dto.group !== undefined) updates.group = dto.group.trim();
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.is_llm_assignable !== undefined) updates.is_llm_assignable = dto.is_llm_assignable;
    if (dto.sort_order !== undefined) updates.sort_order = dto.sort_order;
    if (dto.weight_hint !== undefined) updates.weight_hint = dto.weight_hint;
    if (dto.organization_id !== undefined) updates.organization_id = dto.organization_id;

    if (Object.keys(updates).length === 0) {
      return this.getById(tagId);
    }

    const { data, error } = await client
      .from('tags')
      .update(updates)
      .eq('tag_id', tagId)
      .select(TAG_LIST_SELECT)
      .maybeSingle();

    if (error) {
      if (error.code === '23505' || error.message.includes('duplicate')) {
        throw new ConflictException('A tag with this name or slug already exists');
      }
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Tag not found');
    }
    return this.mapListRow(data as unknown as TagListRow);
  }

  async delete(tagId: string): Promise<void> {
    const client = this.requireClient();
    const { data, error } = await client.from('tags').delete().eq('tag_id', tagId).select('tag_id');
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data?.length) {
      throw new NotFoundException('Tag not found');
    }
  }
}
