import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CreateExposureDto, UpdateExposureDto } from './dto';

const EXPOSURE_SELECT =
  'exposure_id, name, slug, category, description, is_active, sort_order, polarity, visibility, marketing_slug, hero_image_url, marketing_settings, created_at, updated_at';

export interface ExposureRow {
  exposure_id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  is_active: boolean;
  sort_order: number | null;
  polarity: number | null;
  visibility: string;
  marketing_slug: string | null;
  hero_image_url: string | null;
  marketing_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ExposuresService {
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

  async list(activeOnly?: boolean): Promise<ExposureRow[]> {
    const client = this.requireClient();
    let q = client.from('exposures').select(EXPOSURE_SELECT).order('sort_order', { ascending: true, nullsFirst: false });
    q = q.order('name', { ascending: true });
    if (activeOnly) {
      q = q.eq('is_active', true);
    }
    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data ?? []) as unknown as ExposureRow[];
  }

  async getById(exposureId: string): Promise<ExposureRow> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('exposures')
      .select(EXPOSURE_SELECT)
      .eq('exposure_id', exposureId)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Exposure not found');
    }
    return data as unknown as ExposureRow;
  }

  async create(dto: CreateExposureDto): Promise<ExposureRow> {
    const client = this.requireClient();
    const slug = dto.slug.trim().toLowerCase();
    const insert = {
      name: dto.name.trim(),
      slug,
      category: dto.category.trim(),
      description: dto.description ?? null,
      is_active: dto.is_active ?? true,
      sort_order: dto.sort_order ?? null,
      polarity: dto.polarity ?? null,
    };
    const { data, error } = await client.from('exposures').insert(insert).select(EXPOSURE_SELECT).single();
    if (error) {
      if (error.code === '23505' || error.message.includes('duplicate')) {
        throw new ConflictException('An exposure with this name or slug already exists');
      }
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new BadRequestException('Insert failed');
    }
    return data as unknown as ExposureRow;
  }

  async update(exposureId: string, dto: UpdateExposureDto): Promise<ExposureRow> {
    const client = this.requireClient();
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.slug !== undefined) updates.slug = dto.slug.trim().toLowerCase();
    if (dto.category !== undefined) updates.category = dto.category.trim();
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.sort_order !== undefined) updates.sort_order = dto.sort_order;
    if (dto.polarity !== undefined) updates.polarity = dto.polarity;

    if (Object.keys(updates).length === 0) {
      return this.getById(exposureId);
    }

    const { data, error } = await client
      .from('exposures')
      .update(updates)
      .eq('exposure_id', exposureId)
      .select(EXPOSURE_SELECT)
      .maybeSingle();

    if (error) {
      if (error.code === '23505' || error.message.includes('duplicate')) {
        throw new ConflictException('An exposure with this name or slug already exists');
      }
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Exposure not found');
    }
    return data as unknown as ExposureRow;
  }

  async delete(exposureId: string): Promise<void> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('exposures')
      .delete()
      .eq('exposure_id', exposureId)
      .select('exposure_id');
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data?.length) {
      throw new NotFoundException('Exposure not found');
    }
  }
}
