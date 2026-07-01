import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  buildIlikeOrFilter,
  emptySearchResponse,
  escapeIlikePattern,
  mapExposureRow,
  mapFormulaRow,
  mapStockRow,
  mapTagRow,
  normalizeSearchQuery,
  rankStocksForSearch,
  resolveSearchLimit,
  type PublicMarketingSearchResponse,
} from './marketing-search-public.helpers';

const DEFAULT_ORG_SLUG = 'default-organization';

const FORMULA_SELECT = 'name, description, marketing_slug, key';
const EXPOSURE_SELECT = 'name, description, marketing_slug, slug, category, sort_order';
const TAG_SELECT = 'name, description, marketing_slug, slug, group, sort_order';
const STOCK_SELECT = 'id, ticker, name';

@Injectable()
export class MarketingSearchService {
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

  private async resolveDefaultOrganizationId(): Promise<string | null> {
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
      return null;
    }
    this.defaultOrganizationId = data.id;
    return data.id;
  }

  async search(query: string, limitRaw?: string | number): Promise<PublicMarketingSearchResponse> {
    const q = normalizeSearchQuery(query);
    if (!q) {
      return emptySearchResponse();
    }
    const limit = resolveSearchLimit(limitRaw);
    const escaped = escapeIlikePattern(q);
    const filter = buildIlikeOrFilter(['name', 'marketing_slug', 'key'], escaped);

    const client = this.requireClient();
    const defaultOrgId = await this.resolveDefaultOrganizationId();

    const [formulasRes, exposuresRes, tagsRes, stocksRes] = await Promise.all([
      client
        .from('formulas')
        .select(FORMULA_SELECT)
        .eq('visibility', 'public')
        .not('marketing_slug', 'is', null)
        .or(filter)
        .order('name', { ascending: true })
        .limit(limit),
      client
        .from('exposures')
        .select(EXPOSURE_SELECT)
        .eq('visibility', 'public')
        .eq('is_active', true)
        .not('marketing_slug', 'is', null)
        .or(buildIlikeOrFilter(['name', 'marketing_slug', 'slug'], escaped))
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true })
        .limit(limit),
      defaultOrgId
        ? client
            .from('tags')
            .select(TAG_SELECT)
            .eq('visibility', 'public')
            .eq('is_active', true)
            .eq('organization_id', defaultOrgId)
            .not('marketing_slug', 'is', null)
            .or(buildIlikeOrFilter(['name', 'marketing_slug', 'slug'], escaped))
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('name', { ascending: true })
            .limit(limit)
        : Promise.resolve({ data: [], error: null }),
      client
        .from('securities')
        .select(STOCK_SELECT)
        .eq('active', true)
        .eq('market', 'stocks')
        .eq('locale', 'us')
        .or(buildIlikeOrFilter(['ticker', 'name'], escaped))
        .order('ticker', { ascending: true })
        .limit(Math.max(limit * 3, limit)),
    ]);

    if (formulasRes.error) throw new BadRequestException(formulasRes.error.message);
    if (exposuresRes.error) throw new BadRequestException(exposuresRes.error.message);
    if (tagsRes.error) throw new BadRequestException(tagsRes.error.message);
    if (stocksRes.error) throw new BadRequestException(stocksRes.error.message);

    const formulas = (formulasRes.data ?? [])
      .map((row) => mapFormulaRow(row as Record<string, unknown>))
      .filter((row): row is NonNullable<typeof row> => row != null);

    const exposures = (exposuresRes.data ?? [])
      .map((row) => mapExposureRow(row as Record<string, unknown>))
      .filter((row): row is NonNullable<typeof row> => row != null);

    const tags = (tagsRes.data ?? [])
      .map((row) => mapTagRow(row as Record<string, unknown>))
      .filter((row): row is NonNullable<typeof row> => row != null);

    const stocks = rankStocksForSearch(
      (stocksRes.data ?? [])
        .map((row) => mapStockRow(row as Record<string, unknown>))
        .filter((row): row is NonNullable<typeof row> => row != null),
      q,
    ).slice(0, limit);

    return { formulas, exposures, tags, stocks };
  }
}
