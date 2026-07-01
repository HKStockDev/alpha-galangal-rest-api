import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ClientsService } from '../clients/clients.service';
import { TestLogService } from '../common/test-log.service';
import { WatchlistsService } from '../watchlists/watchlists.service';
import { MultiFormulaScreenerQueryDto } from '../watchlists/dto/multi-formula-screener.query.dto';
import { AssistantCacheService } from './assistant-cache.service';
import {
  MVP_ALL_TOOL_KEYS,
  MUTATING_TOOL_KEY_SET,
  UNCACHEABLE_TOOL_KEYS,
} from './assistant.constants';
import { KnowledgeSearchService } from './knowledge-search.service';

export type ToolExecutionContext = {
  organizationId: string;
  userId: string;
  organizationClientId: string | null;
};

@Injectable()
export class AssistantToolExecutorService {
  private adminClient: SupabaseClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly clientsService: ClientsService,
    private readonly watchlistsService: WatchlistsService,
    private readonly cache: AssistantCacheService,
    private readonly knowledgeSearchService: KnowledgeSearchService,
    private readonly testLog: TestLogService,
  ) {
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

  isAllowedTool(toolKey: string): boolean {
    return (MVP_ALL_TOOL_KEYS as readonly string[]).includes(toolKey);
  }

  isMutatingTool(toolKey: string): boolean {
    return MUTATING_TOOL_KEY_SET.has(toolKey);
  }

  async execute(
    toolKey: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<unknown> {
    this.testLog.log('AssistantToolExecutorService.execute', 'input', {
      toolKey,
      args,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      organizationClientId: ctx.organizationClientId,
    });

    if (!this.isAllowedTool(toolKey)) {
      throw new BadRequestException(`Tool not enabled: ${toolKey}`);
    }

    if (!UNCACHEABLE_TOOL_KEYS.has(toolKey)) {
      const cached = this.cache.get({
        organizationId: ctx.organizationId,
        clientId: ctx.organizationClientId,
        toolKey,
        args,
      });
      if (cached !== undefined) {
        this.testLog.log('AssistantToolExecutorService.execute', 'output', {
          toolKey,
          cached: true,
          result: cached,
        });
        return cached;
      }
    }

    let result: unknown;
    switch (toolKey) {
      case 'tool.client.lookup':
        result = await this.clientLookup(args, ctx);
        break;
      case 'tool.watchlist.read':
        result = await this.watchlistRead(args, ctx);
        break;
      case 'tool.formula.read':
        result = await this.formulaRead(args, ctx);
        break;
      case 'tool.org.summary':
        result = await this.orgSummary(ctx);
        break;
      case 'tool.release.status':
        result = await this.releaseStatus(args, ctx);
        break;
      case 'tool.knowledge.search':
        result = await this.knowledgeSearch(args, ctx);
        break;
      case 'tool.watchlist.create':
        result = await this.watchlistCreate(args, ctx);
        break;
      case 'tool.watchlist.add_stocks':
        result = await this.watchlistAddStocks(args, ctx);
        break;
      case 'tool.watchlist.remove_stocks':
        result = await this.watchlistRemoveStocks(args, ctx);
        break;
      case 'tool.formula.create':
        result = await this.formulaCreate(args, ctx);
        break;
      case 'tool.formula.explain':
        result = await this.formulaExplain(args, ctx);
        break;
      case 'tool.screen.run':
        result = await this.screenRun(args, ctx);
        break;
      case 'tool.watchlist.create_from_screen':
        result = await this.watchlistCreateFromScreen(args, ctx);
        break;
      default:
        throw new BadRequestException(`Unknown tool: ${toolKey}`);
    }

    if (!UNCACHEABLE_TOOL_KEYS.has(toolKey)) {
      this.cache.set({
        organizationId: ctx.organizationId,
        clientId: ctx.organizationClientId,
        toolKey,
        args,
        value: result,
      });
    }

    this.testLog.log('AssistantToolExecutorService.execute', 'output', {
      toolKey,
      cached: false,
      result,
    });

    return result;
  }

  private clampLimit(raw: unknown, fallback: number, max: number): number {
    const n = typeof raw === 'number' ? raw : fallback;
    return Math.min(Math.max(1, Math.floor(n)), max);
  }

  private slugifyKey(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    return base || 'formula';
  }

  private parseTickers(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      throw new BadRequestException('tickers must be a non-empty array');
    }
    const tickers = raw
      .map((t) => (typeof t === 'string' ? t.trim().toUpperCase() : ''))
      .filter(Boolean);
    if (tickers.length === 0) {
      throw new BadRequestException('tickers must be a non-empty array');
    }
    return tickers;
  }

  private async lookupSecurityIdByTicker(ticker: string): Promise<string | null> {
    const { data, error } = await this.supabase()
      .from('securities')
      .select('id')
      .eq('market', 'stocks')
      .eq('locale', 'us')
      .eq('ticker', ticker)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data?.id as string | undefined) ?? null;
  }

  private async resolveWatchlistId(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<string> {
    const watchlistId = typeof args.watchlist_id === 'string' ? args.watchlist_id : null;
    if (watchlistId) {
      await this.watchlistsService.getOwnedWatchlist(
        ctx.organizationId,
        ctx.userId,
        watchlistId,
      );
      return watchlistId;
    }

    const nameQuery =
      typeof args.watchlist_name === 'string' ? args.watchlist_name.trim().toLowerCase() : '';
    if (!nameQuery) {
      throw new BadRequestException('Provide watchlist_id or watchlist_name');
    }

    const lists = await this.watchlistsService.listWatchlists(ctx.organizationId, ctx.userId, {
      organization_client_id: ctx.organizationClientId ?? undefined,
    });
    const matches = lists.filter((w: { name?: string }) =>
      (w.name ?? '').toLowerCase().includes(nameQuery),
    );
    if (matches.length === 1) {
      return matches[0].id as string;
    }
    if (matches.length > 1) {
      throw new BadRequestException(
        'Multiple watchlists match; provide watchlist_id to disambiguate',
      );
    }
    throw new NotFoundException('Watchlist not found');
  }

  private buildScreenerQuery(args: Record<string, unknown>): MultiFormulaScreenerQueryDto {
    const query = new MultiFormulaScreenerQueryDto();
    if (typeof args.q === 'string') query.q = args.q;
    if (typeof args.limit === 'number') query.limit = args.limit;
    if (typeof args.offset === 'number') query.offset = args.offset;
    if (typeof args.min_fundamental_constriction_score === 'number') {
      query.min_fundamental_constriction_score = args.min_fundamental_constriction_score;
    }
    if (typeof args.max_fundamental_constriction_score === 'number') {
      query.max_fundamental_constriction_score = args.max_fundamental_constriction_score;
    }
    if (typeof args.min_net_exposure_score === 'number') {
      query.min_net_exposure_score = args.min_net_exposure_score;
    }
    if (typeof args.max_net_exposure_score === 'number') {
      query.max_net_exposure_score = args.max_net_exposure_score;
    }
    if (typeof args.min_insider_conviction_score === 'number') {
      query.min_insider_conviction_score = args.min_insider_conviction_score;
    }
    if (typeof args.max_insider_conviction_score === 'number') {
      query.max_insider_conviction_score = args.max_insider_conviction_score;
    }
    if (typeof args.min_political_score === 'number') {
      query.min_political_score = args.min_political_score;
    }
    if (typeof args.max_political_score === 'number') {
      query.max_political_score = args.max_political_score;
    }
    if (typeof args.sort_by === 'string') {
      query.sort_by = args.sort_by as MultiFormulaScreenerQueryDto['sort_by'];
    }
    if (args.sort_dir === 'asc' || args.sort_dir === 'desc') {
      query.sort_dir = args.sort_dir;
    }
    return query;
  }

  private async clientLookup(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const limit = this.clampLimit(args.limit, 20, 100);
    const clientId = typeof args.client_id === 'string' ? args.client_id : null;
    if (clientId) {
      const client = await this.clientsService.getClient(ctx.organizationId, clientId);
      return { clients: [client] };
    }
    const all = await this.clientsService.listClients(ctx.organizationId);
    const q = typeof args.name_query === 'string' ? args.name_query.trim().toLowerCase() : '';
    const filtered = q
      ? all.filter((c: { name?: string }) => (c.name ?? '').toLowerCase().includes(q))
      : all;
    return { clients: filtered.slice(0, limit) };
  }

  private async watchlistRead(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const globalOnly = args.global_only === true;
    const clientId = ctx.organizationClientId;
    const query = {
      global_only: globalOnly && !clientId ? true : undefined,
      organization_client_id: clientId && !globalOnly ? clientId : undefined,
    };
    const lists = await this.watchlistsService.listWatchlists(
      ctx.organizationId,
      ctx.userId,
      query as { global_only?: boolean; organization_client_id?: string },
    );
    const limit = this.clampLimit(args.limit, 20, 100);
    return { watchlists: lists.slice(0, limit) };
  }

  private async formulaRead(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const sb = this.supabase();
    const limit = this.clampLimit(args.limit, 20, 100);
    const formulaId = typeof args.formula_id === 'string' ? args.formula_id : null;

    if (formulaId) {
      const { data, error } = await sb
        .from('formulas')
        .select(
          'id, key, name, description, display_formula, formula_origin, equation_visibility_mode, visibility, organization_id',
        )
        .eq('id', formulaId)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) return { formulas: [] };
      if (
        data.organization_id &&
        data.organization_id !== ctx.organizationId &&
        data.visibility !== 'public'
      ) {
        return { formulas: [] };
      }
      return { formulas: [this.redactFormula(data)] };
    }

    let q = sb
      .from('formulas')
      .select(
        'id, key, name, description, display_formula, formula_origin, equation_visibility_mode, visibility, organization_id',
      )
      .or(`organization_id.eq.${ctx.organizationId},visibility.eq.public`)
      .order('name', { ascending: true })
      .limit(limit);

    const nameQuery = typeof args.name_query === 'string' ? args.name_query.trim() : '';
    if (nameQuery) {
      q = q.ilike('name', `%${nameQuery}%`);
    }

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { formulas: (data ?? []).map((row) => this.redactFormula(row)) };
  }

  private redactFormula(row: Record<string, unknown>) {
    const origin = row.formula_origin as string | undefined;
    const visibilityMode = row.equation_visibility_mode as string | undefined;
    const out = { ...row };
    if (origin === 'system' && visibilityMode === 'hidden') {
      delete out.display_formula;
      out.equation_redacted = true;
    }
    return out;
  }

  private async orgSummary(ctx: ToolExecutionContext) {
    const sb = this.supabase();
    const orgId = ctx.organizationId;

    const [clients, watchlists, formulas] = await Promise.all([
      sb.from('organization_clients').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
      sb
        .from('organization_watchlists')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('user_id', ctx.userId),
      sb
        .from('formulas')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId),
    ]);

    return {
      organization_id: orgId,
      client_count: clients.count ?? 0,
      watchlist_count: watchlists.count ?? 0,
      organization_formula_count: formulas.count ?? 0,
    };
  }

  private async releaseStatus(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const sb = this.supabase();
    const limit = this.clampLimit(args.limit, 5, 20);
    const formulaId = typeof args.formula_id === 'string' ? args.formula_id : null;
    const ticker = typeof args.ticker === 'string' ? args.ticker.trim().toUpperCase() : null;

    const resolvedFormulaId = formulaId;
    if (!resolvedFormulaId) {
      return {
        releases: [],
        note: ticker
          ? `Ticker ${ticker}: provide formula_id for release lookup in MVP.`
          : 'Provide formula_id to look up releases.',
      };
    }

    const { data: formula } = await sb
      .from('formulas')
      .select('id, organization_id, visibility')
      .eq('id', resolvedFormulaId)
      .maybeSingle();

    if (
      formula?.organization_id &&
      formula.organization_id !== ctx.organizationId &&
      formula.visibility !== 'public'
    ) {
      return { releases: [] };
    }

    const { data, error } = await sb
      .from('formula_marketing_releases')
      .select('id, formula_id, title, subtitle, published_at, is_published, as_of')
      .eq('formula_id', resolvedFormulaId)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw new BadRequestException(error.message);
    return { releases: data ?? [] };
  }

  private async knowledgeSearch(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const query = typeof args.query === 'string' ? args.query : '';
    return this.knowledgeSearchService.search({
      organizationId: ctx.organizationId,
      organizationClientId: ctx.organizationClientId,
      query,
      sourceTypes: args.source_types,
      limit: args.limit,
    });
  }

  private async watchlistCreate(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!name) {
      throw new BadRequestException('name is required');
    }
    const clientId =
      typeof args.organization_client_id === 'string'
        ? args.organization_client_id
        : ctx.organizationClientId;

    const watchlist = await this.watchlistsService.createWatchlist(ctx.organizationId, ctx.userId, {
      name,
      description: typeof args.description === 'string' ? args.description : null,
      organization_client_id: clientId,
    });
    return { watchlist };
  }

  private async watchlistAddStocks(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const watchlistId = await this.resolveWatchlistId(args, ctx);
    const tickers = this.parseTickers(args.tickers);
    const added: unknown[] = [];
    const notFound: string[] = [];
    const errors: Array<{ ticker: string; message: string }> = [];

    for (const ticker of tickers) {
      const securityId = await this.lookupSecurityIdByTicker(ticker);
      if (!securityId) {
        notFound.push(ticker);
        continue;
      }
      try {
        const row = await this.watchlistsService.addSecurity(
          ctx.organizationId,
          ctx.userId,
          watchlistId,
          { security_id: securityId },
        );
        added.push(row);
      } catch (e) {
        errors.push({
          ticker,
          message: e instanceof Error ? e.message : 'Failed to add',
        });
      }
    }

    return { watchlist_id: watchlistId, added, not_found: notFound, errors };
  }

  private async watchlistRemoveStocks(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const watchlistId = await this.resolveWatchlistId(args, ctx);
    const tickers = new Set(this.parseTickers(args.tickers));
    const items = await this.watchlistsService.listSecurities(
      ctx.organizationId,
      ctx.userId,
      watchlistId,
    );

    const removed: string[] = [];
    const notOnList: string[] = [];

    for (const ticker of tickers) {
      type ItemRow = {
        id: string;
        securities?: { ticker?: string } | { ticker?: string }[] | null;
      };
      const match = (items as ItemRow[]).find((item) => {
        const sec = item.securities;
        const rel = Array.isArray(sec) ? sec[0] : sec;
        return (rel?.ticker ?? '').toUpperCase() === ticker;
      });
      if (!match) {
        notOnList.push(ticker);
        continue;
      }
      await this.watchlistsService.removeSecurityItem(
        ctx.organizationId,
        ctx.userId,
        watchlistId,
        match.id,
      );
      removed.push(ticker);
    }

    return { watchlist_id: watchlistId, removed, not_on_list: notOnList };
  }

  private async formulaCreate(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    const displayFormula =
      typeof args.display_formula === 'string' ? args.display_formula.trim() : '';
    if (!name || !displayFormula) {
      throw new BadRequestException('name and display_formula are required');
    }

    const keyBase = this.slugifyKey(name);
    const key = `${keyBase}_${Date.now().toString(36)}`;

    const { data, error } = await this.supabase()
      .from('formulas')
      .insert({
        organization_id: ctx.organizationId,
        key,
        name,
        description: typeof args.description === 'string' ? args.description : null,
        display_formula: displayFormula,
        definition: { type: 'expression', source: displayFormula },
        output_type: 'number',
        visibility: 'organization',
        formula_origin: 'organization',
        equation_visibility_mode: 'owner_only',
        formula_level: 'DOMAIN_COMPOSITE',
        execution_type: 'deterministic',
        version: 1,
        is_active: true,
        created_by_user_id: ctx.userId,
        updated_by_user_id: ctx.userId,
      })
      .select('id, key, name, description, display_formula')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return { formula: data };
  }

  private async formulaExplain(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const read = await this.formulaRead(args, ctx);
    const formulas = (read as { formulas: Record<string, unknown>[] }).formulas;
    if (!formulas.length) {
      return { explanation: 'Formula not found or not accessible.' };
    }
    const formula = formulas[0];
    return {
      formula_id: formula.id,
      name: formula.name,
      description: formula.description ?? null,
      conceptual_explanation:
        (formula.description as string | undefined) ??
        'This formula evaluates securities using the configured scoring model.',
      equation_redacted: formula.equation_redacted === true,
      display_formula: formula.display_formula ?? null,
    };
  }

  private async screenRun(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const query = this.buildScreenerQuery(args);
    return this.watchlistsService.listMultiFormulaScreener(
      ctx.organizationId,
      ctx.userId,
      query,
    );
  }

  private async watchlistCreateFromScreen(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!name) {
      throw new BadRequestException('name is required');
    }
    const query = this.buildScreenerQuery(args);
    const clientId =
      typeof args.organization_client_id === 'string'
        ? args.organization_client_id
        : ctx.organizationClientId;

    return this.watchlistsService.convertMultiFormulaScreenerToWatchlist(
      ctx.organizationId,
      ctx.userId,
      query,
      {
        name,
        description: typeof args.description === 'string' ? args.description : null,
        organization_client_id: clientId,
      },
    );
  }
}
