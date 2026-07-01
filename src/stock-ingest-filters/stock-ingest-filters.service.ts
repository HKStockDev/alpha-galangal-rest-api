import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PatchStockIngestFiltersDto } from './dto/patch-stock-ingest-filters.dto';
import { StockIngestFiltersResponseDto } from './dto/stock-ingest-filters-response.dto';
import {
  defaultPlatformIngestFilters,
  type PlatformStockIngestFiltersRow,
} from './ingest-filter-evaluator';

@Injectable()
export class StockIngestFiltersService {
  private readonly logger = new Logger(StockIngestFiltersService.name);
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

  async loadRowForIngest(): Promise<PlatformStockIngestFiltersRow> {
    if (!this.adminClient) {
      return defaultPlatformIngestFilters();
    }
    const { data, error } = await this.adminClient
      .from('platform_stock_ingest_filters')
      .select('*')
      .eq('singleton_key', 'default')
      .maybeSingle();
    if (error) {
      this.logger.warn(`loadRowForIngest: ${error.message}`);
      return defaultPlatformIngestFilters();
    }
    if (!data) return defaultPlatformIngestFilters();
    return data as PlatformStockIngestFiltersRow;
  }

  private rowToResponse(row: PlatformStockIngestFiltersRow): StockIngestFiltersResponseDto {
    return {
      exchanges: row.exchanges ?? [],
      security_types: row.security_types ?? [],
      countries: row.countries ?? [],
      min_market_cap_millions:
        row.min_market_cap_usd == null
          ? null
          : row.min_market_cap_usd / 1_000_000,
      min_avg_share_volume_thousands:
        row.min_avg_share_volume == null
          ? null
          : row.min_avg_share_volume / 1000,
      min_price_usd: row.min_price_usd ?? null,
      min_avg_dollar_volume_millions:
        row.min_avg_dollar_volume_usd == null
          ? null
          : row.min_avg_dollar_volume_usd / 1_000_000,
      updated_at: row.updated_at ?? new Date().toISOString(),
      updated_by: row.updated_by ?? null,
    };
  }

  async getFilters(): Promise<StockIngestFiltersResponseDto> {
    const row = await this.loadRowForIngest();
    return this.rowToResponse(row);
  }

  async patchFilters(
    dto: PatchStockIngestFiltersDto,
    userId: string,
  ): Promise<StockIngestFiltersResponseDto> {
    const client = this.requireClient();
    const current = await this.loadRowForIngest();

    const next: Record<string, unknown> = {
      singleton_key: 'default',
      exchanges: dto.exchanges ?? current.exchanges,
      security_types: dto.security_types ?? current.security_types,
      countries: dto.countries ?? current.countries,
      updated_by: userId,
    };

    if (dto.min_market_cap_millions === undefined) {
      next.min_market_cap_usd = current.min_market_cap_usd;
    } else if (dto.min_market_cap_millions === null) {
      next.min_market_cap_usd = null;
    } else {
      next.min_market_cap_usd = dto.min_market_cap_millions * 1_000_000;
    }

    if (dto.min_avg_share_volume_thousands === undefined) {
      next.min_avg_share_volume = current.min_avg_share_volume;
    } else if (dto.min_avg_share_volume_thousands === null) {
      next.min_avg_share_volume = null;
    } else {
      next.min_avg_share_volume = dto.min_avg_share_volume_thousands * 1000;
    }

    if (dto.min_price_usd === undefined) {
      next.min_price_usd = current.min_price_usd;
    } else {
      next.min_price_usd = dto.min_price_usd;
    }

    if (dto.min_avg_dollar_volume_millions === undefined) {
      next.min_avg_dollar_volume_usd = current.min_avg_dollar_volume_usd;
    } else if (dto.min_avg_dollar_volume_millions === null) {
      next.min_avg_dollar_volume_usd = null;
    } else {
      next.min_avg_dollar_volume_usd =
        dto.min_avg_dollar_volume_millions * 1_000_000;
    }

    const { data, error } = await client
      .from('platform_stock_ingest_filters')
      .upsert(next, { onConflict: 'singleton_key' })
      .select('*')
      .single();

    if (error) {
      this.logger.error(`patchFilters: ${error.message}`);
      throw new ServiceUnavailableException(
        'Unable to save stock ingest filters.',
      );
    }

    return this.rowToResponse(data as PlatformStockIngestFiltersRow);
  }
}
