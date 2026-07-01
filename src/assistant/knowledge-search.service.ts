import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EmbeddingService, formatPgVector } from './embedding.service';
import {
  KNOWLEDGE_SOURCE_TYPES,
  KnowledgeIndexService,
  KnowledgeSourceType,
} from './knowledge-index.service';
import {
  allowsSourceType,
  evaluateSearchQuality,
  extractSearchTerms,
  KnowledgeSearchFallbackMeta,
  KnowledgeSearchResultWithLive,
  liveSimilarityFromScore,
  mergeSearchResults,
  scoreTermMatches,
  isPlaceholderSnippet,
} from './knowledge-search.fallback';

export type KnowledgeSearchResult = KnowledgeSearchResultWithLive;

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);
  private adminClient: SupabaseClient | null = null;
  private readonly hasServiceRoleKey: boolean;
  private readonly typesenseNullClientMarker = '__org__';

  constructor(
    private readonly config: ConfigService,
    private readonly embedding: EmbeddingService,
    private readonly index: KnowledgeIndexService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    this.hasServiceRoleKey = !!serviceRoleKey;
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private supabase(): SupabaseClient {
    if (!this.adminClient) {
      throw new BadRequestException('Service unavailable');
    }
    if (!this.hasServiceRoleKey) {
      throw new ServiceUnavailableException(
        'Knowledge Search requires SUPABASE_SERVICE_ROLE_KEY (anon key cannot access knowledge index).',
      );
    }
    return this.adminClient;
  }

  private clampLimit(raw: unknown, fallback: number, max: number): number {
    const n = typeof raw === 'number' ? raw : fallback;
    return Math.min(Math.max(1, Math.floor(n)), max);
  }

  private parseSourceTypes(raw: unknown): KnowledgeSourceType[] | null {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const allowed = new Set<string>(KNOWLEDGE_SOURCE_TYPES);
    const filtered = raw.filter(
      (value): value is KnowledgeSourceType =>
        typeof value === 'string' && allowed.has(value),
    );
    return filtered.length > 0 ? filtered : null;
  }

  private snippet(text: string, maxLen = 400): string {
    const trimmed = text.trim();
    if (trimmed.length <= maxLen) return trimmed;
    return `${trimmed.slice(0, maxLen - 1)}…`;
  }

  private isTypesenseEnabled(): boolean {
    return this.config.get<boolean>('assistant.typesenseEnabled') ?? false;
  }

  private getTypesenseHost(): string | null {
    const raw = this.config.get<string>('assistant.typesenseHost')?.trim();
    if (!raw) return null;
    return raw.replace(/\/+$/, '');
  }

  private getTypesenseApiKey(): string | null {
    return this.config.get<string>('assistant.typesenseApiKey')?.trim() ?? null;
  }

  private getTypesenseCollection(): string {
    return (
      this.config.get<string>('assistant.typesenseCollection')?.trim() ??
      'organization_knowledge_chunks'
    );
  }

  private getTypesenseTimeoutMs(): number {
    return this.config.get<number>('assistant.typesenseTimeoutMs') ?? 8000;
  }

  private async typesenseRequest(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const host = this.getTypesenseHost();
    const apiKey = this.getTypesenseApiKey();
    if (!host || !apiKey) {
      throw new Error('Typesense host/api key missing');
    }

    const headers = new Headers(init.headers ?? {});
    headers.set('X-TYPESENSE-API-KEY', apiKey);
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json');
    }

    return fetch(`${host}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.getTypesenseTimeoutMs()),
    });
  }

  private async ensureTypesenseCollection(): Promise<void> {
    const collection = this.getTypesenseCollection();
    const existing = await this.typesenseRequest(`/collections/${collection}`, {
      method: 'GET',
    });
    if (existing.ok) return;
    if (existing.status !== 404) {
      throw new Error(`Typesense collection lookup failed (${existing.status})`);
    }

    const createRes = await this.typesenseRequest('/collections', {
      method: 'POST',
      body: JSON.stringify({
        name: collection,
        fields: [
          { name: 'id', type: 'string' },
          { name: 'organization_id', type: 'string', facet: true },
          { name: 'organization_client_id', type: 'string', facet: true, optional: true },
          { name: 'source_type', type: 'string', facet: true },
          { name: 'source_id', type: 'string' },
          { name: 'title', type: 'string', optional: true },
          { name: 'content', type: 'string' },
          { name: 'source_updated_at_ts', type: 'int64', optional: true },
        ],
        default_sorting_field: 'source_updated_at_ts',
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Typesense collection create failed (${createRes.status}): ${body}`);
    }
  }

  private buildSourceKey(sourceType: string, sourceId: string): string {
    return `${sourceType}:${sourceId}`;
  }

  private isFallbackEnabled(): boolean {
    return this.config.get<boolean>('assistant.knowledgeSearchFallbackEnabled') ?? true;
  }

  private getMinSimilarity(): number {
    return this.config.get<number>('assistant.knowledgeSearchMinSimilarity') ?? 0.55;
  }

  private rankSearchResults(results: KnowledgeSearchResult[]): KnowledgeSearchResult[] {
    return [...results].sort((a, b) => {
      const aPlaceholder = isPlaceholderSnippet(a.snippet);
      const bPlaceholder = isPlaceholderSnippet(b.snippet);
      if (aPlaceholder !== bPlaceholder) {
        return aPlaceholder ? 1 : -1;
      }
      if (Boolean(a.live_fetch) !== Boolean(b.live_fetch)) {
        return a.live_fetch ? -1 : 1;
      }
      return b.similarity - a.similarity;
    });
  }

  private async liveSupplement(params: {
    organizationId: string;
    organizationClientId: string | null;
    query: string;
    sourceTypes: KnowledgeSourceType[] | null;
    limit: number;
    excludeKeys: Set<string>;
  }): Promise<{ results: KnowledgeSearchResult[]; sourcesQueried: string[] }> {
    const terms = extractSearchTerms(params.query);
    if (terms.length === 0) {
      return { results: [], sourcesQueried: [] };
    }

    const tasks: Array<Promise<KnowledgeSearchResult[]>> = [];
    const sourcesQueried: string[] = [];

    if (allowsSourceType(params.sourceTypes, 'formula_release_body')) {
      sourcesQueried.push('formula_marketing_releases');
      tasks.push(
        this.liveReleaseBodySearch({
          organizationId: params.organizationId,
          terms,
          limit: params.limit,
          excludeKeys: params.excludeKeys,
        }),
      );
    }

    if (allowsSourceType(params.sourceTypes, 'formula_release_body')) {
      sourcesQueried.push('formulas.description');
      tasks.push(
        this.liveFormulaDescriptionSearch({
          organizationId: params.organizationId,
          terms,
          limit: params.limit,
          excludeKeys: params.excludeKeys,
        }),
      );
    }

    if (allowsSourceType(params.sourceTypes, 'client_entity_risk_notes')) {
      sourcesQueried.push('client_entities');
      tasks.push(
        this.liveClientEntitySearch({
          organizationId: params.organizationId,
          organizationClientId: params.organizationClientId,
          terms,
          limit: params.limit,
          excludeKeys: params.excludeKeys,
        }),
      );
    }

    const batches = await Promise.all(tasks);
    const combined = batches.flat().sort((a, b) => b.similarity - a.similarity);
    return {
      results: combined.slice(0, params.limit),
      sourcesQueried,
    };
  }

  private async liveReleaseBodySearch(params: {
    organizationId: string;
    terms: string[];
    limit: number;
    excludeKeys: Set<string>;
  }): Promise<KnowledgeSearchResult[]> {
    const sb = this.supabase();
    const { data: formulas, error: formulaErr } = await sb
      .from('formulas')
      .select('id, name')
      .or(`organization_id.eq.${params.organizationId},visibility.eq.public`);

    if (formulaErr) {
      throw new BadRequestException(formulaErr.message);
    }

    const formulaIds = (formulas ?? []).map((f) => f.id as string);
    if (formulaIds.length === 0) return [];

    const formulaNameById = new Map(
      (formulas ?? []).map((f) => [f.id as string, f.name as string]),
    );

    const { data, error } = await sb
      .from('formula_marketing_releases')
      .select('id, formula_id, title, subtitle, body, updated_at')
      .in('formula_id', formulaIds)
      .eq('is_published', true)
      .not('body', 'is', null)
      .limit(200);

    if (error) {
      throw new BadRequestException(error.message);
    }

    const scored: Array<{ row: KnowledgeSearchResult; score: number }> = [];
    for (const row of data ?? []) {
      const body = (row.body as string | null)?.trim();
      if (!body || body.length < 20) continue;

      const titleParts = [
        formulaNameById.get(row.formula_id as string),
        row.title as string,
        row.subtitle as string | null,
      ].filter(Boolean);
      const content = titleParts.length ? `${titleParts.join(' — ')}\n\n${body}` : body;
      const score = scoreTermMatches(content, params.terms);
      if (score <= 0) continue;

      const sourceId = row.id as string;
      const key = this.buildSourceKey('formula_release_body', sourceId);
      if (params.excludeKeys.has(key)) continue;

      scored.push({
        score,
        row: {
          source_type: 'formula_release_body',
          source_id: sourceId,
          organization_client_id: null,
          title: (row.title as string) ?? null,
          snippet: this.snippet(content),
          similarity: 0,
          live_fetch: true,
        },
      });
    }

    if (scored.length === 0) return [];
    const maxScore = Math.max(...scored.map((item) => item.score));
    return scored
      .map((item) => ({
        ...item.row,
        similarity: liveSimilarityFromScore(item.score, maxScore),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, params.limit);
  }

  private async liveFormulaDescriptionSearch(params: {
    organizationId: string;
    terms: string[];
    limit: number;
    excludeKeys: Set<string>;
  }): Promise<KnowledgeSearchResult[]> {
    const sb = this.supabase();
    const { data, error } = await sb
      .from('formulas')
      .select('id, key, name, description')
      .or(`organization_id.eq.${params.organizationId},visibility.eq.public`)
      .not('description', 'is', null)
      .limit(200);

    if (error) {
      throw new BadRequestException(error.message);
    }

    const scored: Array<{ row: KnowledgeSearchResult; score: number }> = [];
    for (const row of data ?? []) {
      const description = (row.description as string | null)?.trim();
      if (!description) continue;

      const content = `${row.name as string}\n\n${description}`;
      const score = scoreTermMatches(content, params.terms);
      if (score <= 0) continue;

      const sourceId = row.id as string;
      const key = this.buildSourceKey('formula_description', sourceId);
      if (params.excludeKeys.has(key)) continue;

      scored.push({
        score,
        row: {
          source_type: 'formula_description',
          source_id: sourceId,
          organization_client_id: null,
          title: row.name as string,
          snippet: this.snippet(content),
          similarity: 0,
          live_fetch: true,
        },
      });
    }

    if (scored.length === 0) return [];
    const maxScore = Math.max(...scored.map((item) => item.score));
    return scored
      .map((item) => ({
        ...item.row,
        similarity: liveSimilarityFromScore(item.score, maxScore),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, params.limit);
  }

  private async liveClientEntitySearch(params: {
    organizationId: string;
    organizationClientId: string | null;
    terms: string[];
    limit: number;
    excludeKeys: Set<string>;
  }): Promise<KnowledgeSearchResult[]> {
    const sb = this.supabase();
    let clientQuery = sb
      .from('organization_clients')
      .select('id')
      .eq('organization_id', params.organizationId);

    if (params.organizationClientId) {
      clientQuery = clientQuery.eq('id', params.organizationClientId);
    }

    const { data: clients, error: clientErr } = await clientQuery.limit(500);
    if (clientErr) {
      throw new BadRequestException(clientErr.message);
    }

    const clientIds = (clients ?? []).map((c) => c.id as string);
    if (clientIds.length === 0) return [];

    const { data, error } = await sb
      .from('client_entities')
      .select('id, display_name, risk_notes, notes, client_id')
      .in('client_id', clientIds)
      .limit(500);

    if (error) {
      throw new BadRequestException(error.message);
    }

    const scored: Array<{ row: KnowledgeSearchResult; score: number }> = [];
    for (const row of data ?? []) {
      const parts = [
        (row.risk_notes as string | null)?.trim(),
        (row.notes as string | null)?.trim(),
      ].filter(Boolean);
      if (parts.length === 0) continue;

      const content = `Client entity: ${row.display_name as string}\n${parts.join('\n\n')}`;
      const score = scoreTermMatches(content, params.terms);
      if (score <= 0) continue;

      const sourceId = row.id as string;
      const key = this.buildSourceKey('client_entity_risk_notes', sourceId);
      if (params.excludeKeys.has(key)) continue;

      scored.push({
        score,
        row: {
          source_type: 'client_entity_risk_notes',
          source_id: sourceId,
          organization_client_id: row.client_id as string,
          title: row.display_name as string,
          snippet: this.snippet(content),
          similarity: 0,
          live_fetch: true,
        },
      });
    }

    if (scored.length === 0) return [];
    const maxScore = Math.max(...scored.map((item) => item.score));
    return scored
      .map((item) => ({
        ...item.row,
        similarity: liveSimilarityFromScore(item.score, maxScore),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, params.limit);
  }

  private async syncTypesenseIndex(params: {
    organizationId: string;
  }): Promise<void> {
    const syncLimit = this.config.get<number>('assistant.typesenseSyncLimit') ?? 5000;
    const sb = this.supabase();
    const { data, error } = await sb
      .from('organization_knowledge_chunks')
      .select(
        'organization_id, organization_client_id, source_type, source_id, title, content, source_updated_at',
      )
      .eq('organization_id', params.organizationId)
      .order('source_updated_at', { ascending: false })
      .limit(syncLimit);

    if (error) {
      throw new Error(`[typesense:source] ${error.message}`);
    }

    await this.ensureTypesenseCollection();
    const collection = this.getTypesenseCollection();
    const purgeRes = await this.typesenseRequest(
      `/collections/${collection}/documents?filter_by=organization_id:=${params.organizationId}`,
      { method: 'DELETE' },
    );
    if (!(purgeRes.ok || purgeRes.status === 404)) {
      const body = await purgeRes.text();
      throw new Error(`[typesense:purge] ${purgeRes.status} ${body}`);
    }

    if (!data?.length) return;

    const payload = data
      .map((row) =>
        JSON.stringify({
          id: this.buildSourceKey(String(row.source_type), String(row.source_id)),
          organization_id: String(row.organization_id),
          organization_client_id:
            (row.organization_client_id as string | null) ?? this.typesenseNullClientMarker,
          source_type: String(row.source_type),
          source_id: String(row.source_id),
          title: (row.title as string | null) ?? '',
          content: String(row.content ?? ''),
          source_updated_at_ts: Math.floor(
            Date.parse(String(row.source_updated_at ?? new Date().toISOString())) / 1000,
          ),
        }),
      )
      .join('\n');

    const importRes = await this.typesenseRequest(
      `/collections/${collection}/documents/import?action=upsert&dirty_values=coerce`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: payload,
      },
    );
    if (!importRes.ok) {
      const body = await importRes.text();
      throw new Error(`[typesense:import] ${importRes.status} ${body}`);
    }
  }

  private buildTypesenseFilter(params: {
    organizationId: string;
    organizationClientId: string | null;
    sourceTypes: KnowledgeSourceType[] | null;
  }): string {
    let filter = `organization_id:=${params.organizationId}`;
    if (params.organizationClientId) {
      filter += ` && organization_client_id:=[${this.typesenseNullClientMarker},${params.organizationClientId}]`;
    }
    if (params.sourceTypes?.length) {
      filter += ` && source_type:=[${params.sourceTypes.join(',')}]`;
    }
    return filter;
  }

  private async searchTypesense(params: {
    organizationId: string;
    organizationClientId: string | null;
    query: string;
    sourceTypes: KnowledgeSourceType[] | null;
    limit: number;
  }): Promise<KnowledgeSearchResult[]> {
    await this.syncTypesenseIndex({ organizationId: params.organizationId });
    const collection = this.getTypesenseCollection();
    const searchParams = new URLSearchParams({
      q: params.query,
      query_by: 'title,content',
      filter_by: this.buildTypesenseFilter({
        organizationId: params.organizationId,
        organizationClientId: params.organizationClientId,
        sourceTypes: params.sourceTypes,
      }),
      per_page: String(params.limit),
      prioritize_exact_match: 'true',
      sort_by: '_text_match:desc,source_updated_at_ts:desc',
    });

    const res = await this.typesenseRequest(
      `/collections/${collection}/documents/search?${searchParams.toString()}`,
      { method: 'GET' },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[typesense:search] ${res.status} ${body}`);
    }

    const json = (await res.json()) as {
      hits?: Array<{
        text_match?: number;
        document?: {
          source_type?: string;
          source_id?: string;
          organization_client_id?: string;
          title?: string;
          content?: string;
        };
      }>;
    };

    const results: KnowledgeSearchResult[] = [];
    for (const hit of json.hits ?? []) {
      const doc = hit.document;
      if (!doc?.source_type || !doc.source_id || !doc.content) continue;
      const rawSimilarity = Number(hit.text_match ?? 0);
      results.push({
        source_type: doc.source_type as KnowledgeSourceType,
        source_id: doc.source_id,
        organization_client_id:
          doc.organization_client_id === this.typesenseNullClientMarker
            ? null
            : (doc.organization_client_id ?? null),
        title: doc.title ?? null,
        snippet: this.snippet(doc.content),
        similarity: Math.max(0, Math.min(0.89, rawSimilarity / 1_000_000)),
      });
    }
    return results;
  }

  async search(params: {
    organizationId: string;
    organizationClientId: string | null;
    query: string;
    sourceTypes?: unknown;
    limit?: unknown;
  }): Promise<{
    query: string;
    results: KnowledgeSearchResult[];
    index_stats: { indexed: number; skipped: number };
    fallback?: KnowledgeSearchFallbackMeta;
  }> {
    const query = params.query.trim();
    if (!query) {
      throw new BadRequestException('query is required');
    }

    const limit = this.clampLimit(
      params.limit,
      this.config.get<number>('assistant.knowledgeSearchTopK') ?? 8,
      20,
    );
    const sourceTypes = this.parseSourceTypes(params.sourceTypes);

    let indexStats: { indexed: number; skipped: number };
    try {
      indexStats = await this.index.syncOrganization({
        organizationId: params.organizationId,
        organizationClientId: params.organizationClientId,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown indexing error';
      throw new BadRequestException(`[knowledge.search:index] ${msg}`);
    }

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embedding.embedText(query);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown embedding error';
      throw new BadRequestException(`[knowledge.search:embed] ${msg}`);
    }
    const sb = this.supabase();

    const { data, error } = await sb.rpc('search_organization_knowledge', {
      p_organization_id: params.organizationId,
      p_organization_client_id: params.organizationClientId,
      p_query_embedding: formatPgVector(queryEmbedding),
      p_source_types: sourceTypes,
      p_match_count: limit,
    });

    if (error) {
      throw new BadRequestException(`[knowledge.search:rpc] ${error.message}`);
    }

    const vectorResults: KnowledgeSearchResult[] = (data ?? []).map(
      (row: {
        source_type: KnowledgeSourceType;
        source_id: string;
        organization_client_id: string | null;
        title: string | null;
        content: string;
        similarity: number;
      }) => ({
        source_type: row.source_type,
        source_id: row.source_id,
        organization_client_id: row.organization_client_id,
        title: row.title,
        snippet: this.snippet(row.content),
        similarity: Number(row.similarity ?? 0),
      }),
    );

    let fuzzyResults: KnowledgeSearchResult[] = [];
    if (this.isTypesenseEnabled()) {
      try {
        fuzzyResults = await this.searchTypesense({
          organizationId: params.organizationId,
          organizationClientId: params.organizationClientId,
          query,
          sourceTypes,
          limit,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown typesense error';
        this.logger.warn(`[knowledge.search:typesense] ${msg}`);
      }
    }

    const merged = mergeSearchResults(vectorResults, fuzzyResults, limit);

    const quality = evaluateSearchQuality({
      results: merged,
      query,
      sourceTypes,
      minSimilarity: this.getMinSimilarity(),
      fallbackEnabled: this.isFallbackEnabled(),
    });

    let fallback: KnowledgeSearchFallbackMeta | undefined;
    let finalResults = merged;

    if (quality.needsFallback) {
      try {
        const excludeKeys = new Set(
          merged.map((row) => this.buildSourceKey(row.source_type, row.source_id)),
        );
        const live = await this.liveSupplement({
          organizationId: params.organizationId,
          organizationClientId: params.organizationClientId,
          query,
          sourceTypes,
          limit,
          excludeKeys,
        });

        if (live.results.length > 0) {
          finalResults = mergeSearchResults(merged, live.results, limit);
        }

        finalResults = this.rankSearchResults(finalResults).slice(0, limit);

        fallback = {
          triggered: true,
          reason: quality.reason,
          live_hits: live.results.length,
          sources_queried: live.sourcesQueried,
        };
        this.logger.log(
          `[knowledge.search:fallback] reason=${quality.reason} live_hits=${live.results.length}`,
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown fallback error';
        this.logger.warn(`[knowledge.search:fallback] ${msg}`);
        fallback = {
          triggered: true,
          reason: quality.reason,
          live_hits: 0,
          sources_queried: [],
        };
      }
    }

    return {
      query,
      results: finalResults,
      index_stats: indexStats,
      ...(fallback ? { fallback } : {}),
    };
  }
}
