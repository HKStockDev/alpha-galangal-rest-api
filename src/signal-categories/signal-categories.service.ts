import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CreateSignalCategoryDto, UpdateSignalCategoryDto } from './dto';

const SIGNAL_CATEGORY_SELECT = 'id, name, description';

export interface SignalCategoryRow {
  id: string;
  name: string;
  description: string | null;
}

@Injectable()
export class SignalCategoriesService {
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

  async list(): Promise<SignalCategoryRow[]> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('signal_categories')
      .select(SIGNAL_CATEGORY_SELECT)
      .order('name', { ascending: true });
    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data ?? []) as SignalCategoryRow[];
  }

  async getById(id: string): Promise<SignalCategoryRow> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('signal_categories')
      .select(SIGNAL_CATEGORY_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Signal category not found');
    }
    return data as SignalCategoryRow;
  }

  async create(dto: CreateSignalCategoryDto): Promise<SignalCategoryRow> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('signal_categories')
      .insert({
        name: dto.name.trim(),
        description: dto.description ?? null,
      })
      .select(SIGNAL_CATEGORY_SELECT)
      .single();
    if (error) {
      if (error.code === '23505' || error.message.toLowerCase().includes('duplicate')) {
        throw new ConflictException('A signal category with this name already exists');
      }
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new BadRequestException('Insert failed');
    }
    return data as SignalCategoryRow;
  }

  async update(id: string, dto: UpdateSignalCategoryDto): Promise<SignalCategoryRow> {
    const client = this.requireClient();
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.description !== undefined) updates.description = dto.description;

    if (Object.keys(updates).length === 0) {
      return this.getById(id);
    }

    const { data, error } = await client
      .from('signal_categories')
      .update(updates)
      .eq('id', id)
      .select(SIGNAL_CATEGORY_SELECT)
      .maybeSingle();

    if (error) {
      if (error.code === '23505' || error.message.toLowerCase().includes('duplicate')) {
        throw new ConflictException('A signal category with this name already exists');
      }
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Signal category not found');
    }
    return data as SignalCategoryRow;
  }

  async delete(id: string): Promise<void> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('signal_categories')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      if (error.code === '23503' || error.message.toLowerCase().includes('foreign key')) {
        throw new BadRequestException('Cannot delete category while formulas still reference it');
      }
      throw new BadRequestException(error.message);
    }
    if (!data?.length) {
      throw new NotFoundException('Signal category not found');
    }
  }
}
