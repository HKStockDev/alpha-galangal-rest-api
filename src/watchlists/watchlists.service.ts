import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  AddWatchlistSecurityDto,
  ConvertMultiFormulaScreenerDto,
  ConvertWatchlistScopeDto,
  CreateOrganizationWatchlistDto,
  DuplicateOrganizationWatchlistDto,
  ListOrganizationWatchlistsQueryDto,
  MultiFormulaScreenerQueryDto,
  MultiFormulaSortColumn,
  UpdateOrganizationWatchlistDto,
  UpdateWatchlistSecurityItemDto,
} from './dto';
import { buildWatchlistCsv } from './csv-export.util';

type MultiFormulaScreenerRow = {
  security_id: string;
  ticker: string;
  name: string;
  fundamental_constriction_score: number | null;
  net_exposure_score: number | null;
  insider_conviction_score: number | null;
  political_score: number | null;
  america_first_score: number | null;
};

type MultiFormulaScreenerListResult = {
  items: MultiFormulaScreenerRow[];
  has_more: boolean;
  offset: number;
  limit: number;
  total_count: number;
  sort_by: MultiFormulaSortColumn;
  sort_dir: 'asc' | 'desc';
};

const MULTI_FORMULA_KEY_BY_COLUMN: Record<Exclude<MultiFormulaSortColumn, 'ticker'>, string> = {
  fundamental_constriction_score: 'fundamental_constriction_score',
  net_exposure_score: 'net_exposure_score',
  insider_conviction_score: 'insider_conviction_score',
  political_score: 'political_score',
  america_first_score: 'america_first_score',
};

@Injectable()
export class WatchlistsService {
  private adminClient: SupabaseClient | null = null;

  constructor(private config: ConfigService) {
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

  private async assertClientInOrg(organizationId: string, clientId: string) {
    const { data, error } = await this.supabase()
      .from('organization_clients')
      .select('id')
      .eq('id', clientId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new BadRequestException('organization_client_id does not belong to this organization');
    }
  }

  private async assertOwnedConversation(
    organizationId: string,
    userId: string,
    conversationId: string,
  ) {
    const { data, error } = await this.supabase()
      .from('organization_llm_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new BadRequestException(
        'source_organization_llm_conversation_id is not a valid conversation for this member',
      );
    }
  }

  private escapeIlikePattern(raw: string): string {
    return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  }

  private applyMinMaxFilter(
    rows: MultiFormulaScreenerRow[],
    key: keyof MultiFormulaScreenerRow,
    minVal: number | undefined,
    maxVal: number | undefined,
  ): MultiFormulaScreenerRow[] {
    const hasMin = minVal !== undefined && Number.isFinite(minVal);
    const hasMax = maxVal !== undefined && Number.isFinite(maxVal);
    if (!hasMin && !hasMax) return rows;
    return rows.filter((row) => {
      const v = row[key];
      if (typeof v !== 'number' || Number.isNaN(v)) return false;
      if (hasMin && v < minVal!) return false;
      if (hasMax && v > maxVal!) return false;
      return true;
    });
  }

  private async listMultiFormulaScreenerAllRows(
    organizationId: string,
    query: MultiFormulaScreenerQueryDto,
  ): Promise<MultiFormulaScreenerRow[]> {
    void organizationId;
    const qText = query.q?.trim() ?? '';
    const supabase = this.supabase();
    let baseQ = supabase
      .from('securities')
      .select('id, ticker, name, entity_id')
      .eq('active', true)
      .eq('market', 'stocks')
      .eq('locale', 'us')
      .not('entity_id', 'is', null);
    if (qText) {
      const esc = this.escapeIlikePattern(qText);
      baseQ = baseQ.or(`ticker.ilike.%${esc}%,name.ilike.%${esc}%`);
    }
    const { data: secRows, error: secErr } = await baseQ.limit(5000);
    if (secErr) throw new BadRequestException(secErr.message);
    const securities = (secRows ??
      []) as Array<{ id: string; ticker: string; name: string; entity_id: string | null }>;
    if (securities.length === 0) return [];

    const entityIds = [
      ...new Set(
        securities
          .map((s) => s.entity_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ];

    const { data: formulas, error: formulaErr } = await supabase
      .from('formulas')
      .select('id, key')
      .in('key', Object.values(MULTI_FORMULA_KEY_BY_COLUMN));
    if (formulaErr) throw new BadRequestException(formulaErr.message);
    const formulaIdByKey = new Map<string, string>(
      (formulas ?? []).map((f: { id: string; key: string }) => [f.key, f.id]),
    );
    const formulaIds = [...formulaIdByKey.values()];
    if (formulaIds.length === 0) {
      return securities.map((s) => ({
        security_id: s.id,
        ticker: s.ticker,
        name: s.name,
        fundamental_constriction_score: null,
        net_exposure_score: null,
        insider_conviction_score: null,
        political_score: null,
        america_first_score: null,
      }));
    }

    const { data: scoreRows, error: scoreErr } = await supabase
      .from('entity_scores_current')
      .select('entity_id, formula_id, score')
      .in('entity_id', entityIds)
      .in('formula_id', formulaIds);
    if (scoreErr) throw new BadRequestException(scoreErr.message);

    const formulaKeyById = new Map<string, string>(
      [...formulaIdByKey.entries()].map(([k, id]) => [id, k]),
    );
    const byEntity = new Map<string, Partial<MultiFormulaScreenerRow>>();
    for (const row of (scoreRows ?? []) as Array<{
      entity_id: string;
      formula_id: string;
      score: number | null;
    }>) {
      const formulaKey = formulaKeyById.get(row.formula_id);
      if (!formulaKey) continue;
      const curr = byEntity.get(row.entity_id) ?? {};
      if (formulaKey === 'fundamental_constriction_score') {
        curr.fundamental_constriction_score = row.score;
      } else if (formulaKey === 'net_exposure_score') {
        curr.net_exposure_score = row.score;
      } else if (formulaKey === 'insider_conviction_score') {
        curr.insider_conviction_score = row.score;
      } else if (formulaKey === 'political_score') {
        curr.political_score = row.score;
      } else if (formulaKey === 'america_first_score') {
        curr.america_first_score = row.score;
      }
      byEntity.set(row.entity_id, curr);
    }

    let rows: MultiFormulaScreenerRow[] = securities.map((s) => {
      const e = s.entity_id ? byEntity.get(s.entity_id) : undefined;
      return {
        security_id: s.id,
        ticker: s.ticker,
        name: s.name,
        fundamental_constriction_score: e?.fundamental_constriction_score ?? null,
        net_exposure_score: e?.net_exposure_score ?? null,
        insider_conviction_score: e?.insider_conviction_score ?? null,
        political_score: e?.political_score ?? null,
        america_first_score: e?.america_first_score ?? null,
      };
    });

    rows = this.applyMinMaxFilter(
      rows,
      'fundamental_constriction_score',
      query.min_fundamental_constriction_score,
      query.max_fundamental_constriction_score,
    );
    rows = this.applyMinMaxFilter(
      rows,
      'net_exposure_score',
      query.min_net_exposure_score,
      query.max_net_exposure_score,
    );
    rows = this.applyMinMaxFilter(
      rows,
      'insider_conviction_score',
      query.min_insider_conviction_score,
      query.max_insider_conviction_score,
    );
    rows = this.applyMinMaxFilter(
      rows,
      'political_score',
      query.min_political_score,
      query.max_political_score,
    );
    rows = this.applyMinMaxFilter(
      rows,
      'america_first_score',
      query.min_america_first_score,
      query.max_america_first_score,
    );

    return rows;
  }

  async listWatchlists(
    organizationId: string,
    userId: string,
    query: ListOrganizationWatchlistsQueryDto,
  ) {
    if (query.global_only === true && query.organization_client_id) {
      throw new BadRequestException(
        'Use either global_only or organization_client_id, not both',
      );
    }

    let q = this.supabase()
      .from('organization_watchlists')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false });

    if (query.global_only === true) {
      q = q.is('organization_client_id', null);
    } else if (query.organization_client_id) {
      await this.assertClientInOrg(organizationId, query.organization_client_id);
      q = q.eq('organization_client_id', query.organization_client_id);
    }

    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(error.message);
    }
    return data ?? [];
  }

  async createWatchlist(
    organizationId: string,
    userId: string,
    dto: CreateOrganizationWatchlistDto,
  ) {
    const clientId =
      dto.organization_client_id === undefined || dto.organization_client_id === null
        ? null
        : dto.organization_client_id;

    if (clientId) {
      await this.assertClientInOrg(organizationId, clientId);
    }

    const sourceConvId =
      dto.source_organization_llm_conversation_id === undefined ||
      dto.source_organization_llm_conversation_id === null
        ? null
        : dto.source_organization_llm_conversation_id;

    if (sourceConvId) {
      await this.assertOwnedConversation(organizationId, userId, sourceConvId);
    }

    const row: Record<string, unknown> = {
      organization_id: organizationId,
      user_id: userId,
      organization_client_id: clientId,
      source_organization_llm_conversation_id: sourceConvId,
      name: dto.name,
      description: dto.description ?? null,
      sort_order: dto.sort_order ?? null,
      metadata_json: dto.metadata_json ?? {},
    };

    const { data, error } = await this.supabase()
      .from('organization_watchlists')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async getOwnedWatchlist(
    organizationId: string,
    userId: string,
    watchlistId: string,
  ) {
    const { data, error } = await this.supabase()
      .from('organization_watchlists')
      .select('*')
      .eq('id', watchlistId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Watchlist not found');
    }
    return data;
  }

  async updateWatchlist(
    organizationId: string,
    userId: string,
    watchlistId: string,
    dto: UpdateOrganizationWatchlistDto,
  ) {
    await this.getOwnedWatchlist(organizationId, userId, watchlistId);

    if (dto.source_organization_llm_conversation_id !== undefined) {
      const sid = dto.source_organization_llm_conversation_id;
      if (sid !== null) {
        await this.assertOwnedConversation(organizationId, userId, sid);
      }
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.sort_order !== undefined) patch.sort_order = dto.sort_order;
    if (dto.metadata_json !== undefined) patch.metadata_json = dto.metadata_json;
    if (dto.source_organization_llm_conversation_id !== undefined) {
      patch.source_organization_llm_conversation_id =
        dto.source_organization_llm_conversation_id;
    }

    if (Object.keys(patch).length === 0) {
      return this.getOwnedWatchlist(organizationId, userId, watchlistId);
    }

    const { data, error } = await this.supabase()
      .from('organization_watchlists')
      .update(patch)
      .eq('id', watchlistId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async deleteWatchlist(organizationId: string, userId: string, watchlistId: string) {
    await this.getOwnedWatchlist(organizationId, userId, watchlistId);

    const { error } = await this.supabase()
      .from('organization_watchlists')
      .delete()
      .eq('id', watchlistId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId);

    if (error) {
      throw new BadRequestException(error.message);
    }
  }

  async listSecurities(organizationId: string, userId: string, watchlistId: string) {
    await this.getOwnedWatchlist(organizationId, userId, watchlistId);

    const { data, error } = await this.supabase()
      .from('organization_watchlist_securities')
      .select(
        'id, watchlist_id, security_id, sort_order, note, added_at, securities (*)',
      )
      .eq('watchlist_id', watchlistId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('added_at', { ascending: true });

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data ?? [];
  }

  private async assertSecurityExists(securityId: string) {
    const { data, error } = await this.supabase()
      .from('securities')
      .select('id')
      .eq('id', securityId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new BadRequestException('security_id does not exist');
    }
  }

  async addSecurity(
    organizationId: string,
    userId: string,
    watchlistId: string,
    dto: AddWatchlistSecurityDto,
  ) {
    await this.getOwnedWatchlist(organizationId, userId, watchlistId);
    await this.assertSecurityExists(dto.security_id);

    const { data, error } = await this.supabase()
      .from('organization_watchlist_securities')
      .insert({
        watchlist_id: watchlistId,
        security_id: dto.security_id,
        sort_order: dto.sort_order ?? null,
        note: dto.note ?? null,
      })
      .select(
        'id, watchlist_id, security_id, sort_order, note, added_at, securities (*)',
      )
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException('Security is already on this watchlist');
      }
      throw new BadRequestException(error.message);
    }
    return data;
  }

  private async getOwnedItem(
    organizationId: string,
    userId: string,
    watchlistId: string,
    itemId: string,
  ) {
    await this.getOwnedWatchlist(organizationId, userId, watchlistId);

    const { data, error } = await this.supabase()
      .from('organization_watchlist_securities')
      .select('id, watchlist_id, security_id, sort_order, note, added_at')
      .eq('id', itemId)
      .eq('watchlist_id', watchlistId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Watchlist item not found');
    }
    return data;
  }

  async updateSecurityItem(
    organizationId: string,
    userId: string,
    watchlistId: string,
    itemId: string,
    dto: UpdateWatchlistSecurityItemDto,
  ) {
    await this.getOwnedItem(organizationId, userId, watchlistId, itemId);

    const patch: Record<string, unknown> = {};
    if (dto.sort_order !== undefined) patch.sort_order = dto.sort_order;
    if (dto.note !== undefined) patch.note = dto.note;

    if (Object.keys(patch).length === 0) {
      const { data, error } = await this.supabase()
        .from('organization_watchlist_securities')
        .select(
          'id, watchlist_id, security_id, sort_order, note, added_at, securities (*)',
        )
        .eq('id', itemId)
        .single();
      if (error) {
        throw new BadRequestException(error.message);
      }
      return data;
    }

    const { data, error } = await this.supabase()
      .from('organization_watchlist_securities')
      .update(patch)
      .eq('id', itemId)
      .eq('watchlist_id', watchlistId)
      .select(
        'id, watchlist_id, security_id, sort_order, note, added_at, securities (*)',
      )
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async removeSecurityItem(
    organizationId: string,
    userId: string,
    watchlistId: string,
    itemId: string,
  ) {
    await this.getOwnedItem(organizationId, userId, watchlistId, itemId);

    const { error } = await this.supabase()
      .from('organization_watchlist_securities')
      .delete()
      .eq('id', itemId)
      .eq('watchlist_id', watchlistId);

    if (error) {
      throw new BadRequestException(error.message);
    }
  }

  async duplicateWatchlist(
    organizationId: string,
    userId: string,
    watchlistId: string,
    dto: DuplicateOrganizationWatchlistDto,
  ) {
    const source = await this.getOwnedWatchlist(organizationId, userId, watchlistId);

    const includeSecurities = dto.include_securities !== false;

    const rawName = dto.name?.trim() || `${String(source.name)} (copy)`;
    const newName = rawName.length > 500 ? rawName.slice(0, 500) : rawName;

    const metadata =
      source.metadata_json != null && typeof source.metadata_json === 'object'
        ? (JSON.parse(JSON.stringify(source.metadata_json)) as Record<string, unknown>)
        : {};

    const insertRow: Record<string, unknown> = {
      organization_id: organizationId,
      user_id: userId,
      organization_client_id: source.organization_client_id ?? null,
      source_organization_llm_conversation_id: null,
      name: newName,
      description: source.description ?? null,
      sort_order: source.sort_order ?? null,
      metadata_json: metadata,
    };

    const { data: created, error: insertError } = await this.supabase()
      .from('organization_watchlists')
      .insert(insertRow)
      .select('*')
      .single();

    if (insertError) {
      throw new BadRequestException(insertError.message);
    }

    if (includeSecurities) {
      const { data: items, error: listError } = await this.supabase()
        .from('organization_watchlist_securities')
        .select('security_id, sort_order, note')
        .eq('watchlist_id', watchlistId);

      if (listError) {
        throw new BadRequestException(listError.message);
      }

      if (items?.length) {
        const rows = items.map((i) => ({
          watchlist_id: created.id,
          security_id: i.security_id,
          sort_order: i.sort_order ?? null,
          note: i.note ?? null,
        }));

        const { error: bulkError } = await this.supabase()
          .from('organization_watchlist_securities')
          .insert(rows);

        if (bulkError) {
          throw new BadRequestException(bulkError.message);
        }
      }
    }

    return this.getOwnedWatchlist(organizationId, userId, created.id);
  }

  async convertWatchlistScope(
    organizationId: string,
    userId: string,
    watchlistId: string,
    dto: ConvertWatchlistScopeDto,
  ) {
    if (dto.organization_client_id === undefined) {
      throw new BadRequestException(
        'organization_client_id is required: use null for global scope or a client UUID',
      );
    }

    const clientId = dto.organization_client_id;
    if (clientId !== null) {
      await this.assertClientInOrg(organizationId, clientId);
    }

    await this.getOwnedWatchlist(organizationId, userId, watchlistId);

    const { data, error } = await this.supabase()
      .from('organization_watchlists')
      .update({ organization_client_id: clientId })
      .eq('id', watchlistId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async listMultiFormulaScreener(
    organizationId: string,
    userId: string,
    query: MultiFormulaScreenerQueryDto,
  ): Promise<MultiFormulaScreenerListResult> {
    void userId;
    const sortBy: MultiFormulaSortColumn = query.sort_by ?? 'ticker';
    const sortDir: 'asc' | 'desc' = query.sort_dir ?? 'asc';
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);

    const rows = await this.listMultiFormulaScreenerAllRows(organizationId, query);

    rows.sort((a, b) => {
      if (sortBy === 'ticker') {
        const cmp = a.ticker.localeCompare(b.ticker, undefined, { sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av === null && bv === null) {
        const cmp = a.ticker.localeCompare(b.ticker, undefined, { sensitivity: 'base' });
        return cmp;
      }
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = av - bv;
      if (cmp === 0) {
        return a.ticker.localeCompare(b.ticker, undefined, { sensitivity: 'base' });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    const total_count = rows.length;
    const items = rows.slice(offset, offset + limit + 1);
    const has_more = items.length > limit;
    return {
      items: has_more ? items.slice(0, limit) : items,
      has_more,
      offset,
      limit,
      total_count,
      sort_by: sortBy,
      sort_dir: sortDir,
    };
  }

  async exportMultiFormulaScreenerCsv(
    organizationId: string,
    userId: string,
    query: MultiFormulaScreenerQueryDto,
  ): Promise<{ body: string; filename: string }> {
    const result = await this.listMultiFormulaScreener(organizationId, userId, {
      ...query,
      limit: 500,
      offset: 0,
    });
    const headers = [
      'ticker',
      'name',
      'fundamental_constriction_score',
      'net_exposure_score',
      'insider_conviction_score',
      'political_score',
      'america_first_score',
    ];
    const rows: string[][] = [
      headers,
      ...result.items.map((item) => [
        item.ticker,
        item.name,
        item.fundamental_constriction_score == null
          ? ''
          : String(item.fundamental_constriction_score),
        item.net_exposure_score == null ? '' : String(item.net_exposure_score),
        item.insider_conviction_score == null ? '' : String(item.insider_conviction_score),
        item.political_score == null ? '' : String(item.political_score),
        item.america_first_score == null ? '' : String(item.america_first_score),
      ]),
    ];
    return {
      body: buildWatchlistCsv(rows),
      filename: `multi-formula-screener-${organizationId.slice(0, 8)}.csv`,
    };
  }

  async convertMultiFormulaScreenerToWatchlist(
    organizationId: string,
    userId: string,
    query: MultiFormulaScreenerQueryDto,
    dto: ConvertMultiFormulaScreenerDto,
  ) {
    if (dto.organization_client_id) {
      await this.assertClientInOrg(organizationId, dto.organization_client_id);
    }

    const created = await this.createWatchlist(organizationId, userId, {
      name: dto.name.trim(),
      description: dto.description ?? null,
      organization_client_id: dto.organization_client_id ?? null,
      metadata_json: { source: 'multi_formula_screener' },
    } as CreateOrganizationWatchlistDto);

    const full = await this.listMultiFormulaScreener(organizationId, userId, {
      ...query,
      limit: 500,
      offset: 0,
    });
    const securityIds = [...new Set(full.items.map((r) => r.security_id))];
    if (securityIds.length > 0) {
      const rows = securityIds.map((security_id, idx) => ({
        watchlist_id: created.id,
        security_id,
        sort_order: idx,
        note: null,
      }));
      const { error } = await this.supabase()
        .from('organization_watchlist_securities')
        .insert(rows);
      if (error) throw new BadRequestException(error.message);
    }

    return {
      watchlist: created,
      count_added: securityIds.length,
    };
  }

  async exportWatchlistCsv(
    organizationId: string,
    userId: string,
    watchlistId: string,
  ): Promise<{ body: string; filename: string }> {
    const watchlist = await this.getOwnedWatchlist(organizationId, userId, watchlistId);
    const items = await this.listSecurities(organizationId, userId, watchlistId);

    type SecRel = {
      ticker?: string;
      market?: string;
      locale?: string;
      name?: string;
    } | null;
    type ItemRow = {
      id: string;
      security_id: string;
      sort_order: number | null;
      note: string | null;
      added_at: string;
      securities?: SecRel;
    };

    const headers = [
      'watchlist_item_id',
      'security_id',
      'ticker',
      'market',
      'locale',
      'security_name',
      'sort_order',
      'note',
      'added_at',
    ] as const;

    const rows: string[][] = [
      [...headers],
      ...(items as ItemRow[]).map((row) => {
        const sec = row.securities;
        return [
          row.id,
          row.security_id,
          sec?.ticker ?? '',
          sec?.market ?? '',
          sec?.locale ?? '',
          sec?.name ?? '',
          row.sort_order === null || row.sort_order === undefined ? '' : String(row.sort_order),
          row.note ?? '',
          row.added_at ?? '',
        ];
      }),
    ];

    const body = buildWatchlistCsv(rows);
    const base = String(watchlist.name ?? 'watchlist')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    const filename = `${base || 'watchlist'}-${watchlistId.slice(0, 8)}.csv`;

    return { body, filename };
  }
}
