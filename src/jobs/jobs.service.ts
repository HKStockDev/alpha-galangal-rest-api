import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { FetchCompanyJobPostsDto } from './dto/fetch-company-job-posts.dto';
import { ListJobPostsQueryDto } from './dto/list-job-posts-query.dto';

export interface IndeedJobPost {
  id: string | null;
  title: string | null;
  companyName: string | null;
  location: string | null;
  salaryText: string | null;
  postedAt: string | null;
  indeedUrl: string | null;
  externalUrl: string | null;
  isRemote: boolean | null;
  isExpired: boolean | null;
}

export interface FetchCompanyIndeedPostsResult {
  source: string;
  companyName: string;
  query: Record<string, unknown>;
  total: number;
  posts: IndeedJobPost[];
}

interface RunApifyIndeedFetchInternalResult {
  source: string;
  companyName: string;
  query: Record<string, unknown>;
  total: number;
  posts: Array<IndeedJobPost & { rawSource: Record<string, unknown> }>;
}

export interface SyncCompanyIndeedPostsResult extends FetchCompanyIndeedPostsResult {
  runId: string | null;
  persisted: number;
  skippedWithoutSourceId: number;
}

export interface StoredJobPostRow {
  id: string;
  provider: string;
  source_job_id: string;
  company_name: string;
  search_company_name: string;
  title: string | null;
  location_text: string | null;
  country_code: string | null;
  salary_text: string | null;
  posted_at: string | null;
  indeed_url: string | null;
  external_url: string | null;
  is_remote: boolean | null;
  is_expired: boolean | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface ListJobPostsResult {
  items: StoredJobPostRow[];
  total_count: number;
  offset: number;
  limit: number;
}

/** Cached Apify output: optional company finder, then logical + riceman headcount actors. */
export type LinkedinHeadcountCache = {
  company_finder?: {
    fetched_at: string;
    domain: string | null;
    linkedin_url: string | null;
    error?: string;
  };
  logical_scraper?: {
    fetched_at: string;
    number_of_employees: number | null;
    company_name?: string | null;
    error?: string;
  };
  riceman?: {
    fetched_at: string;
    employee_count: number | null;
    employee_range?: string | null;
    get_company_insights: boolean;
    get_total_job_openings: boolean;
    total_job_openings?: number | null;
    headcount_growth?: Record<string, string> | null;
    error?: string;
  };
};

export interface ActiveEntitySecurityEmployeeItem {
  security_id: string;
  ticker: string;
  name: string;
  entity_id: string;
  /** From FMP profile sync (securities.total_employees). */
  fmp_headcount: number | null;
  security_updated_at: string;
  /** FMP company website; domain is derived for the Apify company-finder when LinkedIn URL is missing. */
  homepage_url: string | null;
  linkedin_company_url: string | null;
  linkedin_headcount_cache: LinkedinHeadcountCache;
}

export interface ListActiveEntitySecuritiesEmployeeOverviewResult {
  items: ActiveEntitySecurityEmployeeItem[];
  total_count: number;
  offset: number;
  limit: number;
  filters: { market: string; locale: string };
}

/**
 * Per-security job-post counts for the admin "Job counts" page.
 * Indeed values are aggregated from the `job_posts` table (provider = 'apify_indeed'),
 * matched on `LOWER(search_company_name) = LOWER(securities.name)`. Riceman values come
 * from the latest cache stored on the security (set by the headcount workflow).
 */
export interface ActiveEntityJobCountsItem {
  security_id: string;
  ticker: string;
  name: string;
  entity_id: string;
  fmp_headcount: number | null;
  /** Stored Indeed posts: total rows matched by company name (any state). */
  indeed_total_count: number;
  /** Stored Indeed posts where `is_expired` is not true. */
  indeed_active_count: number;
  /** Latest `last_seen_at` across matched Indeed rows. */
  indeed_last_seen_at: string | null;
  /** Riceman `total_job_openings` from cache. */
  riceman_total_job_openings: number | null;
  riceman_employee_count: number | null;
  riceman_fetched_at: string | null;
}

export interface ListActiveEntityJobCountsResult {
  items: ActiveEntityJobCountsItem[];
  total_count: number;
  offset: number;
  limit: number;
  filters: { market: string; locale: string };
}

export interface PatchSecurityLinkedinUrlResult {
  security_id: string;
  linkedin_company_url: string | null;
}

export interface RefreshLinkedinHeadcountResult {
  security_id: string;
  linkedin_company_url: string | null;
  linkedin_headcount_cache: LinkedinHeadcountCache;
}

/** Step 1 (s-r company finder when URL missing): result row for one security. */
export interface ResolveLinkedinCompanyUrlStepResult {
  security_id: string;
  ticker: string;
  name: string;
  fmp_headcount: number | null;
  skipped: boolean;
  linkedin_company_url: string | null;
  linkedin_headcount_cache: LinkedinHeadcountCache;
}

export interface HeadcountFromLinkedinStepResult {
  security_id: string;
  linkedin_company_url: string | null;
  linkedin_headcount_cache: LinkedinHeadcountCache;
}

export interface BatchLinkedinRowResult {
  success: boolean;
  security_id: string;
  ticker?: string;
  name?: string;
  fmp_headcount?: number | null;
  error?: string;
  skipped?: boolean;
  linkedin_company_url?: string | null;
  linkedin_headcount_cache?: LinkedinHeadcountCache;
}

type JobsFactorKey =
  | 'open_jobs_count'
  | 'employee_count_estimate'
  | 'jobs_per_100_employees'
  | 'jobs_growth_rate_30d'
  | 'jobs_growth_rate_90d'
  | 'workforce_growth_rate_90d'
  | 'hiring_spike_indicator';

interface JobsFactorSecurityRow {
  id: string;
  entity_id: string;
  ticker: string;
  name: string;
  total_employees: number | null;
  linkedin_headcount_cache: unknown;
}

interface ComputedJobsMetrics {
  entityId: string;
  securityId: string;
  ticker: string;
  securityName: string;
  openJobsCount: number | null;
  employeeCountEstimate: number | null;
  jobsPer100Employees: number | null;
  jobsGrowthRate30d: number | null;
  jobsGrowthRate90d: number | null;
  workforceGrowthRate90d: number | null;
  hiringSpikeIndicator: number | null;
  openJobsSource: string;
  employeeSource: string;
}

interface HistoricalJobsSnapshotRow {
  entity_id: string;
  as_of_date: string;
  open_jobs_count: number | null;
  employee_count_estimate: number | null;
}

export interface SyncJobsFactorsResult {
  asOfDate: string;
  scanned: number;
  computed: number;
  persistedEntitySnapshots: number;
  persistedCurrentFactors: number;
  persistedTimeSeriesFactors: number;
  dryRun: boolean;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
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
      throw new ServiceUnavailableException('Supabase is not configured on the API server');
    }
    return this.adminClient;
  }

  private getApifyToken(): string | null {
    return (
      this.config.get<string>('apify.token') ??
      this.config.get<string>('APIFY_API_TOKEN') ??
      process.env.APIFY_API_TOKEN ??
      null
    );
  }

  private getApifyBaseUrl(): string {
    return (
      this.config.get<string>('apify.baseUrl') ??
      process.env.APIFY_API_BASE_URL ??
      'https://api.apify.com'
    );
  }

  private getApifyActorId(): string {
    return (
      this.config.get<string>('apify.indeedActorId') ??
      process.env.APIFY_INDEED_ACTOR_ID ??
      'kaix/indeed-scraper'
    );
  }

  private actorIdToPath(actorId: string): string {
    // Apify API expects username~actor-name path format.
    return actorId.replace('/', '~');
  }

  private getLinkedinLogicalScraperActorId(): string {
    return (
      this.config.get<string>('apify.linkedinLogicalCompanyScraperId') ??
      process.env.APIFY_LINKEDIN_LOGICAL_COMPANY_SCRAPER_ID ??
      'logical_scrapers/linkedin-company-scraper'
    );
  }

  private getLinkedinRicemanActorId(): string {
    return (
      this.config.get<string>('apify.linkedinRicemanInsightsId') ??
      process.env.APIFY_LINKEDIN_RICEMAN_INSIGHTS_ID ??
      'riceman/linkedin-company-data-insights-scraper'
    );
  }

  /** @see https://apify.com/s-r/free-linkedin-company-finder---linkedin-address-from-any-site */
  private getLinkedinCompanyFinderActorId(): string {
    return (
      this.config.get<string>('apify.linkedinCompanyFinderId') ??
      process.env.APIFY_LINKEDIN_COMPANY_FINDER_ID ??
      's-r/free-linkedin-company-finder---linkedin-address-from-any-site'
    );
  }

  /**
   * Human-readable apify.com API error (403/400/etc.) for logs and the headcount cache `error` field.
   * Apify often returns JSON like `{ "error": { "type": "..." } }` or `{ "error": "..." }`.
   */
  private formatApifyHttpErrorMessage(status: number, data: unknown): string {
    const head = `Apify request failed (${status})`;
    if (data == null) return head;
    if (typeof data === 'string') {
      const t = data.trim();
      return t ? `${head}: ${t.slice(0, 450)}` : head;
    }
    if (typeof data === 'object' && !Array.isArray(data)) {
      const o = data as Record<string, unknown>;
      const e = o.error;
      if (typeof e === 'string') return `${head}: ${e.slice(0, 450)}`;
      if (e && typeof e === 'object' && !Array.isArray(e)) {
        const nest = e as Record<string, unknown>;
        for (const k of ['message', 'type', 'typeName'] as const) {
          if (typeof nest[k] === 'string') return `${head}: ${(nest[k] as string).slice(0, 450)}`;
        }
      }
      if (typeof o.message === 'string') return `${head}: ${(o.message as string).slice(0, 450)}`;
    }
    try {
      const s = JSON.stringify(data);
      return s.length <= 500 ? `${head}: ${s}` : `${head}: ${s.slice(0, 450)}…`;
    } catch {
      return head;
    }
  }

  /**
   * @see https://apify.com/logical_scrapers/linkedin-company-scraper — input: JSON array of company URLs.
   * @see https://apify.com/riceman/linkedin-company-data-insights-scraper — input: object with company_linkedin_urls.
   */
  private async runApifyRunSyncGetDatasetItems(actorId: string, input: unknown): Promise<unknown[]> {
    const token = this.getApifyToken();
    if (!token) {
      throw new InternalServerErrorException('APIFY_API_TOKEN is not configured on the API server');
    }
    const baseUrl = this.getApifyBaseUrl().replace(/\/$/, '');
    const actorPath = this.actorIdToPath(actorId);
    const url = `${baseUrl}/v2/acts/${encodeURIComponent(actorPath)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&format=json&clean=true`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const msg = this.formatApifyHttpErrorMessage(response.status, data);
      this.logger.warn(`Apify actor ${actorId}: ${msg}`);
      throw new InternalServerErrorException(msg);
    }
    if (!Array.isArray(data)) {
      throw new InternalServerErrorException('Apify response format was not an array');
    }
    return data;
  }

  private coalesceNonNegativeInt(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.trunc(v);
    if (typeof v === 'string') {
      const n = parseInt(v.replace(/[, ]/g, ''), 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  }

  /**
   * Public company page on LinkedIn. Regional hosts (e.g. `ni.linkedin.com/company/…`) are rewritten to
   * `https://www.linkedin.com/company/…` so downstream Apify actors (Logical, Riceman) do not 400/403 on odd hostnames.
   */
  private normalizePublicLinkedinCompanyUrl(raw: string): string {
    const t = raw.trim();
    if (!t) {
      throw new BadRequestException('LinkedIn company URL is empty.');
    }
    let u = t;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    if (!/linkedin\.com\/company\//i.test(u)) {
      throw new BadRequestException('URL must be a public LinkedIn company page (…linkedin.com/company/…).');
    }
    try {
      const url = new URL(u);
      const host = url.hostname.toLowerCase();
      if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
        if (/\/company\//i.test(url.pathname)) {
          return `https://www.linkedin.com${url.pathname}${url.search}${url.hash}`;
        }
      }
    } catch {
      /* keep u */
    }
    return u;
  }

  /**
   * Hostname from FMP `homepage_url` for Apify `domains: ["example.com"]` (no scheme, no leading www).
   */
  private extractDomainFromHomepage(homepage: string | null | undefined): string | null {
    if (!homepage?.trim()) return null;
    try {
      const h = homepage.trim();
      const withScheme = /^https?:\/\//i.test(h) ? h : `https://${h}`;
      const parsed = new URL(withScheme);
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      return host || null;
    } catch {
      return null;
    }
  }

  private extractLinkedinUrlFromCompanyFinderItems(
    items: unknown[],
  ): { linkedinUrl: string | null; matchedDomain: string | null } {
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const dom = o.domain != null ? this.asString(o.domain) : null;
      const u = o.linkedin_url ?? o.linkedinUrl;
      if (typeof u === 'string' && /linkedin\.com\/company\//i.test(u)) {
        const normalized = this.normalizePublicLinkedinCompanyUrl(u);
        return { linkedinUrl: normalized, matchedDomain: dom };
      }
    }
    return { linkedinUrl: null, matchedDomain: null };
  }

  private async callCompanyFinderForDomain(domain: string): Promise<{
    block: NonNullable<LinkedinHeadcountCache['company_finder']>;
    linkedinUrl: string | null;
  }> {
    const fetchedAt = new Date().toISOString();
    const d = domain.trim().toLowerCase().replace(/^www\./, '');
    if (!d) {
      return {
        block: { fetched_at: fetchedAt, domain: null, linkedin_url: null, error: 'Empty domain' },
        linkedinUrl: null,
      };
    }
    const actor = this.getLinkedinCompanyFinderActorId();
    try {
      const items = await this.runApifyRunSyncGetDatasetItems(actor, { domains: [d] });
      const { linkedinUrl } = this.extractLinkedinUrlFromCompanyFinderItems(items);
      return {
        block: {
          fetched_at: fetchedAt,
          domain: d,
          linkedin_url: linkedinUrl,
          error: linkedinUrl ? undefined : 'Apify did not return a linkedin.com/company URL for this domain',
        },
        linkedinUrl,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return {
        block: { fetched_at: fetchedAt, domain: d, linkedin_url: null, error: err },
        linkedinUrl: null,
      };
    }
  }

  private asString(v: unknown): string | null {
    if (v == null) return null;
    const out = String(v).trim();
    return out ? out : null;
  }

  private asBoolean(v: unknown): boolean | null {
    if (typeof v === 'boolean') return v;
    return null;
  }

  private mapIndeedPost(raw: Record<string, unknown>): IndeedJobPost {
    const titleObj = raw.title as Record<string, unknown> | undefined;
    const companyObj = raw.company as Record<string, unknown> | undefined;
    const locationObj = raw.location as Record<string, unknown> | undefined;
    const salaryObj = raw.salary as Record<string, unknown> | undefined;
    const datesObj = raw.dates as Record<string, unknown> | undefined;
    const urlsObj = raw.urls as Record<string, unknown> | undefined;
    const workArrangementObj = raw.workArrangement as Record<string, unknown> | undefined;
    const signalsObj = raw.signals as Record<string, unknown> | undefined;

    return {
      id: this.asString(raw.id),
      title: this.asString(titleObj?.text ?? raw.title),
      companyName: this.asString(companyObj?.name),
      location: this.asString(locationObj?.formatted ?? locationObj?.formattedShort ?? raw.location),
      salaryText: this.asString(salaryObj?.text),
      postedAt: this.asString(datesObj?.posted ?? datesObj?.onIndeed),
      indeedUrl: this.asString(urlsObj?.indeed),
      externalUrl: this.asString(urlsObj?.external),
      isRemote: this.asBoolean(workArrangementObj?.isRemote),
      isExpired: this.asBoolean(signalsObj?.isExpired),
    };
  }

  private mapPostedAtForDb(v: string | null): string | null {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  private mapFromDaysForApify(
    fromDays?: 'any' | '1' | '3' | '7' | '14',
  ): '' | '1' | '3' | '7' | '14' {
    if (!fromDays || fromDays === 'any') return '';
    return fromDays;
  }

  private async runApifyIndeedFetch(
    input: FetchCompanyJobPostsDto,
  ): Promise<RunApifyIndeedFetchInternalResult> {
    const token = this.getApifyToken();
    if (!token) {
      throw new InternalServerErrorException('APIFY_API_TOKEN is not configured on the API server');
    }

    const companyName = input.companyName?.trim();
    if (!companyName) {
      throw new BadRequestException('companyName is required');
    }
    const actorInput = {
      keyword: `company:${companyName}`,
      location: input.location?.trim() || 'United States',
      country: input.country?.trim() || 'US',
      maxItems: input.maxItems ?? 100,
      sort: input.sort ?? 'date',
      fromDays: this.mapFromDaysForApify(input.fromDays),
      searchMode: input.searchMode ?? 'basic',
    };

    const baseUrl = this.getApifyBaseUrl().replace(/\/$/, '');
    const actorPath = this.actorIdToPath(this.getApifyActorId());
    const url = `${baseUrl}/v2/acts/${encodeURIComponent(actorPath)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&format=json&clean=true`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actorInput),
    });

    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data && typeof data === 'object' ? JSON.stringify(data) : response.statusText;
      this.logger.warn(`Apify Indeed fetch failed (${response.status}): ${detail}`);
      throw new InternalServerErrorException(`Apify request failed (${response.status})`);
    }

    if (!Array.isArray(data)) {
      throw new InternalServerErrorException('Apify response format was not an array');
    }

    const posts = data.map((row) => {
      const raw = (row ?? {}) as Record<string, unknown>;
      return {
        ...this.mapIndeedPost(raw),
        rawSource: raw,
      };
    });
    return {
      source: 'apify:kaix/indeed-scraper',
      companyName,
      query: actorInput,
      total: posts.length,
      posts,
    };
  }

  async fetchCompanyIndeedPosts(input: FetchCompanyJobPostsDto): Promise<FetchCompanyIndeedPostsResult> {
    const fetched = await this.runApifyIndeedFetch(input);
    return {
      source: fetched.source,
      companyName: fetched.companyName,
      query: fetched.query,
      total: fetched.total,
      posts: fetched.posts.map(({ rawSource: _rawSource, ...post }) => post),
    };
  }

  async syncCompanyIndeedPosts(
    input: FetchCompanyJobPostsDto,
    requestedBy: string,
  ): Promise<SyncCompanyIndeedPostsResult> {
    const fetched = await this.runApifyIndeedFetch(input);
    const actorId = this.getApifyActorId();
    const now = new Date().toISOString();

    const runInsert = {
      provider: 'apify_indeed',
      actor_id: actorId,
      query: fetched.query,
      requested_by: requestedBy,
      fetched_count: fetched.total,
      persisted_count: 0,
    };

    const { data: runRow, error: runError } = await this.supabase()
      .from('job_post_sync_runs')
      .insert(runInsert)
      .select('id')
      .single();
    if (runError) {
      throw new ServiceUnavailableException(`Failed to create sync run: ${runError.message}`);
    }

    const runId = (runRow as { id: string } | null)?.id ?? null;
    const postRows = fetched.posts
      .filter((p) => p.id)
      .map((p) => ({
        provider: 'apify_indeed',
        source_job_id: p.id!,
        company_name: p.companyName ?? fetched.companyName,
        search_company_name: fetched.companyName,
        title: p.title,
        location_text: p.location,
        country_code: (typeof fetched.query.country === 'string' ? fetched.query.country : null) ?? null,
        salary_text: p.salaryText,
        posted_at: this.mapPostedAtForDb(p.postedAt),
        indeed_url: p.indeedUrl,
        external_url: p.externalUrl,
        is_remote: p.isRemote,
        is_expired: p.isExpired,
        raw: p.rawSource,
        last_seen_at: now,
        last_sync_run_id: runId,
      }));

    let persisted = 0;
    if (postRows.length > 0) {
      const { data: upserted, error: upsertError } = await this.supabase()
        .from('job_posts')
        .upsert(postRows, { onConflict: 'provider,source_job_id' })
        .select('id');
      if (upsertError) {
        throw new ServiceUnavailableException(`Failed to persist job posts: ${upsertError.message}`);
      }
      persisted = (upserted ?? []).length;
    }

    if (runId) {
      const { error: runUpdateError } = await this.supabase()
        .from('job_post_sync_runs')
        .update({ persisted_count: persisted })
        .eq('id', runId);
      if (runUpdateError) {
        this.logger.warn(`Failed to update sync run persisted_count: ${runUpdateError.message}`);
      }
    }

    return {
      ...fetched,
      runId,
      persisted,
      skippedWithoutSourceId: fetched.posts.length - postRows.length,
    };
  }

  async listJobPosts(query: ListJobPostsQueryDto): Promise<ListJobPostsResult> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const sortBy = query.sortBy ?? 'posted_at';
    const sortOrder = query.sortOrder ?? 'desc';

    let q = this.supabase()
      .from('job_posts')
      .select(
        'id, provider, source_job_id, company_name, search_company_name, title, location_text, country_code, salary_text, posted_at, indeed_url, external_url, is_remote, is_expired, last_seen_at, created_at, updated_at',
        { count: 'exact' },
      );

    if (query.q?.trim()) {
      const term = query.q.trim().replace(/[%]/g, '');
      q = q.or(`company_name.ilike.%${term}%,title.ilike.%${term}%`);
    }
    if (query.companyName?.trim()) {
      q = q.ilike('company_name', `%${query.companyName.trim()}%`);
    }
    if (query.location?.trim()) {
      q = q.ilike('location_text', `%${query.location.trim()}%`);
    }
    if (query.isRemote !== undefined) {
      q = q.eq('is_remote', query.isRemote);
    }
    if (query.isExpired !== undefined) {
      q = q.eq('is_expired', query.isExpired);
    }
    if (query.postedFrom) {
      q = q.gte('posted_at', query.postedFrom);
    }
    if (query.postedTo) {
      q = q.lte('posted_at', query.postedTo);
    }

    q = q
      .order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) {
      throw new ServiceUnavailableException(`Failed to list job posts: ${error.message}`);
    }

    return {
      items: (data ?? []) as StoredJobPostRow[],
      total_count: count ?? 0,
      offset,
      limit,
    };
  }

  private async callLogicalScraperForUrl(
    companyUrl: string,
  ): Promise<NonNullable<LinkedinHeadcountCache['logical_scraper']>> {
    const fetchedAt = new Date().toISOString();
    const actor = this.getLinkedinLogicalScraperActorId();
    try {
      const items = await this.runApifyRunSyncGetDatasetItems(actor, [companyUrl]);
      const row = (items[0] ?? null) as Record<string, unknown> | null;
      if (!row) {
        return { fetched_at: fetchedAt, number_of_employees: null, error: 'Empty Apify result' };
      }
      return {
        fetched_at: fetchedAt,
        number_of_employees: this.coalesceNonNegativeInt(row.numberOfEmployees),
        company_name: this.asString(row.name),
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return { fetched_at: fetchedAt, number_of_employees: null, error: err };
    }
  }

  private async callRicemanForUrl(
    companyUrl: string,
    opts: { getCompanyInsights: boolean; getTotalJobOpenings: boolean },
  ): Promise<NonNullable<LinkedinHeadcountCache['riceman']>> {
    const fetchedAt = new Date().toISOString();
    const actor = this.getLinkedinRicemanActorId();
    const input = {
      company_linkedin_urls: [companyUrl],
      get_company_insights: opts.getCompanyInsights,
      get_total_job_openings: opts.getTotalJobOpenings,
    };
    try {
      const items = await this.runApifyRunSyncGetDatasetItems(actor, input);
      const row = (items[0] ?? null) as Record<string, unknown> | null;
      if (!row) {
        return {
          fetched_at: fetchedAt,
          employee_count: null,
          get_company_insights: opts.getCompanyInsights,
          get_total_job_openings: opts.getTotalJobOpenings,
          error: 'Empty Apify result',
        };
      }
      const growth = row.headcount_growth;
      return {
        fetched_at: fetchedAt,
        employee_count: this.coalesceNonNegativeInt(row.employee_count),
        employee_range: this.asString(row.employee_range),
        get_company_insights: opts.getCompanyInsights,
        get_total_job_openings: opts.getTotalJobOpenings,
        total_job_openings: this.coalesceNonNegativeInt(row.total_job_openings),
        headcount_growth:
          growth && typeof growth === 'object' && !Array.isArray(growth)
            ? (growth as Record<string, string>)
            : null,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return {
        fetched_at: fetchedAt,
        employee_count: null,
        get_company_insights: opts.getCompanyInsights,
        get_total_job_openings: opts.getTotalJobOpenings,
        error: err,
      };
    }
  }

  private parseLinkedinHeadcountCache(raw: unknown): LinkedinHeadcountCache {
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as LinkedinHeadcountCache)
      : {};
  }

  /**
   * Same universe as `listActiveEntitySecuritiesEmployeeOverview`: active, `entity_id` set, market/locale.
   */
  private async getSecurityRowForEmployeeOverviewOrNull(
    securityId: string,
    market: 'stocks' | 'crypto' | 'fx' | 'indices' | 'options',
    locale: 'us' | 'global',
  ): Promise<{
    id: string;
    ticker: string;
    name: string;
    total_employees: number | null;
    linkedin_company_url: string | null;
    linkedin_headcount_cache: unknown;
    homepage_url: string | null;
  } | null> {
    const { data, error } = await this.supabase()
      .from('securities')
      .select('id, ticker, name, total_employees, linkedin_company_url, linkedin_headcount_cache, homepage_url')
      .eq('id', securityId)
      .eq('active', true)
      .not('entity_id', 'is', null)
      .eq('market', market)
      .eq('locale', locale)
      .maybeSingle();
    if (error) {
      throw new ServiceUnavailableException(`Failed to read security: ${error.message}`);
    }
    return (data as {
      id: string;
      ticker: string;
      name: string;
      total_employees: number | null;
      linkedin_company_url: string | null;
      linkedin_headcount_cache: unknown;
      homepage_url: string | null;
    }) || null;
  }

  /**
   * Apify s-r company finder only: resolves and persists `linkedin_company_url` + `company_finder` cache.
   * No-op (skipped) if a LinkedIn company URL is already stored.
   */
  async resolveLinkedinCompanyUrlForSecurity(
    securityId: string,
    opts: { domainOverride?: string | null; market?: 'stocks' | 'crypto' | 'fx' | 'indices' | 'options'; locale?: 'us' | 'global' },
  ): Promise<ResolveLinkedinCompanyUrlStepResult> {
    const market = opts.market ?? 'stocks';
    const locale = opts.locale ?? 'us';
    const rec = await this.getSecurityRowForEmployeeOverviewOrNull(securityId, market, locale);
    if (!rec) {
      throw new NotFoundException(
        'Security not found, or it is not an active security with an entity in this market/locale.',
      );
    }
    const baseCache = this.parseLinkedinHeadcountCache(rec.linkedin_headcount_cache);
    const existing = rec.linkedin_company_url?.trim() ?? null;
    if (existing) {
      let canonical = existing;
      try {
        canonical = this.normalizePublicLinkedinCompanyUrl(existing);
      } catch {
        /* keep existing */
      }
      if (canonical !== existing) {
        const { data: row, error: canonErr } = await this.supabase()
          .from('securities')
          .update({ linkedin_company_url: canonical })
          .eq('id', securityId)
          .select('id, linkedin_company_url, linkedin_headcount_cache, ticker, name, total_employees')
          .single();
        if (!canonErr && row) {
          const u = row as {
            id: string;
            linkedin_company_url: string | null;
            linkedin_headcount_cache: unknown;
            ticker: string;
            name: string;
            total_employees: number | null;
          };
          return {
            security_id: u.id,
            ticker: u.ticker,
            name: u.name,
            fmp_headcount: u.total_employees,
            skipped: true,
            linkedin_company_url: u.linkedin_company_url,
            linkedin_headcount_cache: this.parseLinkedinHeadcountCache(u.linkedin_headcount_cache),
          };
        }
        canonical = existing;
      }
      return {
        security_id: rec.id,
        ticker: rec.ticker,
        name: rec.name,
        fmp_headcount: rec.total_employees,
        skipped: true,
        linkedin_company_url: canonical,
        linkedin_headcount_cache: baseCache,
      };
    }
    const domainFromOverride = opts.domainOverride?.trim() || null;
    const domain = domainFromOverride || this.extractDomainFromHomepage(rec.homepage_url);
    if (!domain) {
      throw new BadRequestException(
        'No LinkedIn URL on file. Set FMP homepage on the security so we can resolve the domain, or pass domainOverride in the request body.',
      );
    }
    const { block, linkedinUrl } = await this.callCompanyFinderForDomain(domain);
    baseCache.company_finder = block;
    if (!linkedinUrl) {
      const { error: cacheErr } = await this.supabase()
        .from('securities')
        .update({ linkedin_headcount_cache: baseCache as unknown as Record<string, unknown> })
        .eq('id', securityId);
      if (cacheErr) {
        throw new ServiceUnavailableException(`Failed to save company finder result: ${cacheErr.message}`);
      }
      throw new BadRequestException(
        `Apify company finder could not find a LinkedIn company URL for domain "${domain}".`,
      );
    }
    const { data: upd, error: upErr } = await this.supabase()
      .from('securities')
      .update({
        linkedin_company_url: linkedinUrl,
        linkedin_headcount_cache: baseCache as unknown as Record<string, unknown>,
      })
      .eq('id', securityId)
      .select('id, linkedin_company_url, linkedin_headcount_cache, ticker, name, total_employees')
      .single();
    if (upErr) {
      throw new ServiceUnavailableException(`Failed to save LinkedIn URL: ${upErr.message}`);
    }
    const u = upd as {
      id: string;
      linkedin_company_url: string | null;
      linkedin_headcount_cache: unknown;
      ticker: string;
      name: string;
      total_employees: number | null;
    };
    return {
      security_id: u.id,
      ticker: u.ticker,
      name: u.name,
      fmp_headcount: u.total_employees,
      skipped: false,
      linkedin_company_url: u.linkedin_company_url,
      linkedin_headcount_cache: this.parseLinkedinHeadcountCache(u.linkedin_headcount_cache),
    };
  }

  /**
   * logical_scrapers + riceman Apify actors. Requires a stored public LinkedIn company URL.
   */
  async fetchHeadcountFromLinkedinForSecurity(
    securityId: string,
    opts: {
      getCompanyInsights: boolean;
      getTotalJobOpenings: boolean;
      market?: 'stocks' | 'crypto' | 'fx' | 'indices' | 'options';
      locale?: 'us' | 'global';
    },
  ): Promise<HeadcountFromLinkedinStepResult> {
    const market = opts.market ?? 'stocks';
    const locale = opts.locale ?? 'us';
    const rec = await this.getSecurityRowForEmployeeOverviewOrNull(securityId, market, locale);
    if (!rec) {
      throw new NotFoundException(
        'Security not found, or it is not an active security with an entity in this market/locale.',
      );
    }
    const baseCache = this.parseLinkedinHeadcountCache(rec.linkedin_headcount_cache);
    const raw = rec.linkedin_company_url?.trim() ?? null;
    if (!raw) {
      throw new BadRequestException(
        'Set linkedin_company_url first, or run the company-finder step (Get LinkedIn URLs) using homepage / domain override.',
      );
    }
    const effectiveUrl = this.normalizePublicLinkedinCompanyUrl(raw);
    const logical = await this.callLogicalScraperForUrl(effectiveUrl);
    const riceman = await this.callRicemanForUrl(effectiveUrl, {
      getCompanyInsights: opts.getCompanyInsights,
      getTotalJobOpenings: opts.getTotalJobOpenings,
    });
    const merged: LinkedinHeadcountCache = { ...baseCache, logical_scraper: logical, riceman };
    const { data: upd, error: upErr } = await this.supabase()
      .from('securities')
      .update({
        linkedin_company_url: effectiveUrl,
        linkedin_headcount_cache: merged as unknown as Record<string, unknown>,
      })
      .eq('id', securityId)
      .select('id, linkedin_company_url, linkedin_headcount_cache')
      .single();
    if (upErr) {
      throw new ServiceUnavailableException(`Failed to save headcount cache: ${upErr.message}`);
    }
    const row = upd as { id: string; linkedin_company_url: string | null; linkedin_headcount_cache: unknown };
    return {
      security_id: row.id,
      linkedin_company_url: row.linkedin_company_url,
      linkedin_headcount_cache: this.parseLinkedinHeadcountCache(row.linkedin_headcount_cache),
    };
  }

  async batchResolveLinkedinCompanyUrls(body: {
    securityIds: string[];
    domainOverrideBySecurityId?: Record<string, string>;
    market?: 'stocks' | 'crypto' | 'fx' | 'indices' | 'options';
    locale?: 'us' | 'global';
  }): Promise<{ results: BatchLinkedinRowResult[] }> {
    const { securityIds, domainOverrideBySecurityId: ov, market, locale } = body;
    const results: BatchLinkedinRowResult[] = [];
    for (const securityId of securityIds) {
      try {
        const r = await this.resolveLinkedinCompanyUrlForSecurity(securityId, {
          domainOverride: ov?.[securityId],
          market,
          locale,
        });
        results.push({
          success: true,
          security_id: r.security_id,
          ticker: r.ticker,
          name: r.name,
          fmp_headcount: r.fmp_headcount,
          skipped: r.skipped,
          linkedin_company_url: r.linkedin_company_url,
          linkedin_headcount_cache: r.linkedin_headcount_cache,
        });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        results.push({ success: false, security_id: securityId, error: err });
      }
    }
    return { results };
  }

  async batchFetchHeadcountFromLinkedin(body: {
    securityIds: string[];
    getCompanyInsights: boolean;
    getTotalJobOpenings: boolean;
    market?: 'stocks' | 'crypto' | 'fx' | 'indices' | 'options';
    locale?: 'us' | 'global';
  }): Promise<{ results: BatchLinkedinRowResult[] }> {
    const { securityIds, getCompanyInsights, getTotalJobOpenings, market, locale } = body;
    const results: BatchLinkedinRowResult[] = [];
    for (const securityId of securityIds) {
      try {
        const h = await this.fetchHeadcountFromLinkedinForSecurity(securityId, {
          getCompanyInsights,
          getTotalJobOpenings,
          market,
          locale,
        });
        const rec = await this.getSecurityRowForEmployeeOverviewOrNull(securityId, market ?? 'stocks', locale ?? 'us');
        results.push({
          success: true,
          security_id: h.security_id,
          ticker: rec?.ticker,
          name: rec?.name,
          fmp_headcount: rec?.total_employees ?? null,
          linkedin_company_url: h.linkedin_company_url,
          linkedin_headcount_cache: h.linkedin_headcount_cache,
        });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        results.push({ success: false, security_id: securityId, error: err });
      }
    }
    return { results };
  }

  async patchSecurityLinkedinCompanyUrl(
    securityId: string,
    rawUrl: string | null | undefined,
  ): Promise<PatchSecurityLinkedinUrlResult> {
    if (rawUrl === undefined) {
      throw new BadRequestException('linkedinCompanyUrl is required in the body (string or null to clear).');
    }
    const normalized =
      rawUrl == null || (typeof rawUrl === 'string' && rawUrl.trim() === '')
        ? null
        : this.normalizePublicLinkedinCompanyUrl(rawUrl);
    const { data, error } = await this.supabase()
      .from('securities')
      .update({ linkedin_company_url: normalized })
      .eq('id', securityId)
      .select('id, linkedin_company_url')
      .maybeSingle();
    if (error) {
      throw new ServiceUnavailableException(`Failed to update security: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException('Security not found');
    }
    return {
      security_id: (data as { id: string }).id,
      linkedin_company_url: (data as { linkedin_company_url: string | null }).linkedin_company_url,
    };
  }

  async refreshLinkedinHeadcountCache(
    securityId: string,
    opts: {
      getCompanyInsights: boolean;
      getTotalJobOpenings: boolean;
      resolveLinkedInFromDomain?: boolean;
      domainOverride?: string | null;
    },
  ): Promise<RefreshLinkedinHeadcountResult> {
    const market: 'stocks' = 'stocks';
    const locale: 'us' = 'us';
    const runFinder = opts.resolveLinkedInFromDomain !== false;
    if (runFinder) {
      await this.resolveLinkedinCompanyUrlForSecurity(securityId, { domainOverride: opts.domainOverride, market, locale });
    } else {
      const rec = await this.getSecurityRowForEmployeeOverviewOrNull(securityId, market, locale);
      if (!rec) {
        throw new NotFoundException(
          'Security not found, or it is not an active security with an entity in this market/locale.',
        );
      }
      if (!rec.linkedin_company_url?.trim()) {
        throw new BadRequestException(
          'Set linkedin_company_url, or enable resolveLinkedInFromDomain with homepage_url / domainOverride.',
        );
      }
    }
    return this.fetchHeadcountFromLinkedinForSecurity(securityId, {
      getCompanyInsights: opts.getCompanyInsights,
      getTotalJobOpenings: opts.getTotalJobOpenings,
      market,
      locale,
    });
  }

  async listActiveEntitySecuritiesEmployeeOverview(
    query: {
      q?: string;
      market?: 'stocks' | 'crypto' | 'fx' | 'indices' | 'options';
      locale?: 'us' | 'global';
      offset?: number;
      limit?: number;
      /** When set, only these security IDs (must still match active+entity+market+locale). */
      securityIds?: string[];
    },
  ): Promise<ListActiveEntitySecuritiesEmployeeOverviewResult> {
    const market = query.market ?? 'stocks';
    const locale = query.locale ?? 'us';
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const idFilter = query.securityIds?.length ? query.securityIds : null;

    let q = this.supabase()
      .from('securities')
      .select(
        'id, ticker, name, entity_id, total_employees, updated_at, homepage_url, linkedin_company_url, linkedin_headcount_cache',
        { count: 'exact' },
      )
      .eq('active', true)
      .not('entity_id', 'is', null)
      .eq('market', market)
      .eq('locale', locale)
      .order('ticker', { ascending: true });

    if (idFilter) {
      q = q.in('id', idFilter);
    }

    const search = query.q?.trim();
    if (search) {
      const t = search.replace(/[%_]/g, '');
      if (t) {
        const esc = t.replace(/"/g, '""');
        const p = `%${esc}%`;
        q = q.or(`ticker.ilike."${p}",name.ilike."${p}"`);
      }
    }

    const { data, error, count } = await q.range(offset, offset + limit - 1);
    if (error) {
      throw new ServiceUnavailableException(`Failed to list securities: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
      id: string;
      ticker: string;
      name: string;
      entity_id: string;
      total_employees: number | null;
      updated_at: string;
      homepage_url: string | null;
      linkedin_company_url: string | null;
      linkedin_headcount_cache: unknown;
    }>;

    const items: ActiveEntitySecurityEmployeeItem[] = rows.map((s) => {
      const c = s.linkedin_headcount_cache;
      const cache: LinkedinHeadcountCache =
        c && typeof c === 'object' && !Array.isArray(c) ? (c as LinkedinHeadcountCache) : {};
      return {
        security_id: s.id,
        ticker: s.ticker,
        name: s.name,
        entity_id: s.entity_id,
        fmp_headcount: s.total_employees,
        security_updated_at: s.updated_at,
        homepage_url: s.homepage_url,
        linkedin_company_url: s.linkedin_company_url,
        linkedin_headcount_cache: cache,
      };
    });

    return {
      items,
      total_count: count ?? 0,
      offset,
      limit,
      filters: { market, locale },
    };
  }

  /**
   * CON-? Admin "Job counts": per active security with non-null entity_id, returns
   * stored Indeed `job_posts` counts (matched on name) and Riceman cached totals.
   */
  async listActiveEntityJobCounts(
    query: {
      q?: string;
      market?: 'stocks' | 'crypto' | 'fx' | 'indices' | 'options';
      locale?: 'us' | 'global';
      offset?: number;
      limit?: number;
    },
  ): Promise<ListActiveEntityJobCountsResult> {
    const market = query.market ?? 'stocks';
    const locale = query.locale ?? 'us';
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    let secQuery = this.supabase()
      .from('securities')
      .select(
        'id, ticker, name, entity_id, total_employees, linkedin_headcount_cache',
        { count: 'exact' },
      )
      .eq('active', true)
      .not('entity_id', 'is', null)
      .eq('market', market)
      .eq('locale', locale)
      .order('ticker', { ascending: true });

    const search = query.q?.trim();
    if (search) {
      const t = search.replace(/[%_]/g, '');
      if (t) {
        const esc = t.replace(/"/g, '""');
        const p = `%${esc}%`;
        secQuery = secQuery.or(`ticker.ilike."${p}",name.ilike."${p}"`);
      }
    }

    const { data: secRows, error: secErr, count } = await secQuery.range(
      offset,
      offset + limit - 1,
    );
    if (secErr) {
      throw new ServiceUnavailableException(
        `Failed to list securities for job counts: ${secErr.message}`,
      );
    }

    const securities = (secRows ?? []) as Array<{
      id: string;
      ticker: string;
      name: string;
      entity_id: string;
      total_employees: number | null;
      linkedin_headcount_cache: unknown;
    }>;

    const indeedAggregates = await this.aggregateIndeedJobPostsByName(
      securities.map((s) => s.name),
    );

    const items: ActiveEntityJobCountsItem[] = securities.map((s) => {
      const cache = this.parseLinkedinHeadcountCache(s.linkedin_headcount_cache);
      const ric = cache.riceman;
      const key = s.name.trim().toLowerCase();
      const agg = indeedAggregates.get(key) ?? null;
      return {
        security_id: s.id,
        ticker: s.ticker,
        name: s.name,
        entity_id: s.entity_id,
        fmp_headcount: s.total_employees,
        indeed_total_count: agg?.total ?? 0,
        indeed_active_count: agg?.active ?? 0,
        indeed_last_seen_at: agg?.lastSeenAt ?? null,
        riceman_total_job_openings: this.coalesceNonNegativeInt(
          ric?.total_job_openings ?? null,
        ),
        riceman_employee_count: this.coalesceNonNegativeInt(
          ric?.employee_count ?? null,
        ),
        riceman_fetched_at: ric?.fetched_at ?? null,
      };
    });

    return {
      items,
      total_count: count ?? 0,
      offset,
      limit,
      filters: { market, locale },
    };
  }

  /**
   * Reads `job_posts` (provider = 'apify_indeed') matching the given company names
   * (case-insensitive equality on `search_company_name`), and aggregates per name.
   */
  private async aggregateIndeedJobPostsByName(
    rawNames: string[],
  ): Promise<Map<string, { total: number; active: number; lastSeenAt: string | null }>> {
    const out = new Map<string, { total: number; active: number; lastSeenAt: string | null }>();
    const namesByKey = new Map<string, string>();
    for (const raw of rawNames) {
      const key = (raw ?? '').trim().toLowerCase();
      if (!key) continue;
      if (!namesByKey.has(key)) {
        namesByKey.set(key, raw.trim());
      }
    }
    if (namesByKey.size === 0) return out;

    const orClauses = [...namesByKey.values()].map((name) => {
      const safe = name.replace(/"/g, '""');
      return `search_company_name.ilike."${safe}"`;
    });
    const { data, error } = await this.supabase()
      .from('job_posts')
      .select('search_company_name, is_expired, last_seen_at')
      .eq('provider', 'apify_indeed')
      .or(orClauses.join(','));
    if (error) {
      throw new ServiceUnavailableException(
        `Failed to load job_posts for job counts: ${error.message}`,
      );
    }
    for (const row of (data ?? []) as Array<{
      search_company_name: string | null;
      is_expired: boolean | null;
      last_seen_at: string | null;
    }>) {
      const key = (row.search_company_name ?? '').trim().toLowerCase();
      if (!namesByKey.has(key)) continue;
      const rec = out.get(key) ?? { total: 0, active: 0, lastSeenAt: null };
      rec.total += 1;
      if (row.is_expired !== true) rec.active += 1;
      if (row.last_seen_at) {
        if (!rec.lastSeenAt || row.last_seen_at > rec.lastSeenAt) {
          rec.lastSeenAt = row.last_seen_at;
        }
      }
      out.set(key, rec);
    }
    return out;
  }

  private parseAsOfDate(raw?: string | null): string {
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      return raw.trim();
    }
    return new Date().toISOString().slice(0, 10);
  }

  private parseLinkedinOpenJobs(cache: LinkedinHeadcountCache): number | null {
    const riceman = cache.riceman;
    if (!riceman) return null;
    return this.coalesceNonNegativeInt(riceman.total_job_openings ?? null);
  }

  private parseLinkedinEmployeeEstimate(cache: LinkedinHeadcountCache): number | null {
    const riceman = cache.riceman;
    const logical = cache.logical_scraper;
    return (
      this.coalesceNonNegativeInt(riceman?.employee_count ?? null) ??
      this.coalesceNonNegativeInt(logical?.number_of_employees ?? null)
    );
  }

  private async countOpenJobsBySecurityName(
    securities: JobsFactorSecurityRow[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const namesByKey = new Map<string, string>();
    for (const security of securities) {
      const raw = security.name?.trim() ?? '';
      const key = raw.toLowerCase();
      if (!key) continue;
      if (!namesByKey.has(key)) {
        namesByKey.set(key, raw);
      }
    }
    const names = [...namesByKey.values()];
    if (names.length === 0) return out;

    const orClauses = names.map((name) => {
      const safe = name.replace(/"/g, '""');
      return `search_company_name.ilike."${safe}"`;
    });

    const { data, error } = await this.supabase()
      .from('job_posts')
      .select('search_company_name, is_expired')
      .eq('provider', 'apify_indeed')
      .or(orClauses.join(','));
    if (error) {
      throw new ServiceUnavailableException(`Failed to aggregate job posts: ${error.message}`);
    }
    for (const row of (data ?? []) as { search_company_name: string; is_expired: boolean | null }[]) {
      if (row.is_expired === true) continue;
      const key = (row.search_company_name ?? '').trim().toLowerCase();
      if (!key || !namesByKey.has(key)) continue;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  }

  /**
   * CON-89: active pull from Apify Indeed actor for open jobs count by company name.
   * Uses `kaix/indeed-scraper` via existing actor wiring.
   */
  private async countOpenJobsByActorCompanyName(
    securities: JobsFactorSecurityRow[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const uniqueNames = [
      ...new Set(securities.map((s) => s.name.trim()).filter((n) => n.length > 0)),
    ];
    for (const companyName of uniqueNames) {
      try {
        const fetched = await this.runApifyIndeedFetch({
          companyName,
          maxItems: 200,
          sort: 'date',
          fromDays: 'any',
          searchMode: 'basic',
          country: 'US',
          location: 'United States',
        });
        out.set(companyName.toLowerCase(), fetched.total);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Actor job count failed for "${companyName}": ${msg}`);
      }
    }
    return out;
  }

  private computeJobsMetricsForSecurity(
    security: JobsFactorSecurityRow,
    openJobsByActorName: Map<string, number>,
    openJobsByName: Map<string, number>,
    historyByEntity: Map<string, HistoricalJobsSnapshotRow[]>,
    asOfDate: string,
  ): ComputedJobsMetrics {
    const cache = this.parseLinkedinHeadcountCache(security.linkedin_headcount_cache);
    const nameKey = security.name.trim().toLowerCase();

    const linkedinOpenJobs = this.parseLinkedinOpenJobs(cache);
    const actorOpenJobs = openJobsByActorName.get(nameKey) ?? null;
    const fallbackOpenJobs = openJobsByName.get(nameKey) ?? null;
    // Prefer Riceman (LinkedIn cache) before Indeed actor: actor often returns 0 for US-only
    // searches or mismatches, and `??` would not fall through because 0 is not nullish.
    const openJobsCount = linkedinOpenJobs ?? actorOpenJobs ?? fallbackOpenJobs;
    const openJobsSource =
      linkedinOpenJobs != null
        ? 'linkedin_riceman.total_job_openings'
        : actorOpenJobs != null
          ? 'apify_indeed.actor_count'
          : 'job_posts.company_name_count';

    const linkedinEmployees = this.parseLinkedinEmployeeEstimate(cache);
    const employeeCountEstimate = linkedinEmployees ?? this.coalesceNonNegativeInt(security.total_employees);
    const employeeSource = linkedinEmployees != null ? 'linkedin_headcount_cache' : 'securities.total_employees';

    const jobsPer100Employees =
      employeeCountEstimate != null && employeeCountEstimate > 0 && openJobsCount != null
        ? (openJobsCount / employeeCountEstimate) * 100
        : null;

    const addDays = (yyyyMmDd: string, days: number): string => {
      const dt = new Date(`${yyyyMmDd}T00:00:00.000Z`);
      dt.setUTCDate(dt.getUTCDate() + days);
      return dt.toISOString().slice(0, 10);
    };
    const series = (historyByEntity.get(security.entity_id) ?? [])
      .filter((r) => typeof r.as_of_date === 'string')
      .sort((a, b) => a.as_of_date.localeCompare(b.as_of_date));
    const pickLatestAtOrBefore = (
      rows: HistoricalJobsSnapshotRow[],
      targetDate: string,
      field: 'open_jobs_count' | 'employee_count_estimate',
    ): number | null => {
      let chosen: number | null = null;
      for (const row of rows) {
        if (row.as_of_date <= targetDate) {
          const v = row[field];
          chosen = typeof v === 'number' && Number.isFinite(v) ? v : null;
        } else {
          break;
        }
      }
      return chosen;
    };

    const openJobs30dAgo = pickLatestAtOrBefore(series, addDays(asOfDate, -30), 'open_jobs_count');
    const openJobs90dAgo = pickLatestAtOrBefore(series, addDays(asOfDate, -90), 'open_jobs_count');
    const employees90dAgo = pickLatestAtOrBefore(
      series,
      addDays(asOfDate, -90),
      'employee_count_estimate',
    );

    const jobsGrowthRate30d =
      openJobsCount != null && openJobs30dAgo != null && openJobs30dAgo !== 0
        ? (openJobsCount - openJobs30dAgo) / openJobs30dAgo
        : null;
    const jobsGrowthRate90d =
      openJobsCount != null && openJobs90dAgo != null && openJobs90dAgo !== 0
        ? (openJobsCount - openJobs90dAgo) / openJobs90dAgo
        : null;
    const workforceGrowthRate90d =
      employeeCountEstimate != null && employees90dAgo != null && employees90dAgo !== 0
        ? (employeeCountEstimate - employees90dAgo) / employees90dAgo
        : null;

    const windowStart90 = addDays(asOfDate, -90);
    const openInWindow = series
      .filter((r) => r.as_of_date >= windowStart90 && r.as_of_date <= asOfDate)
      .map((r) => r.open_jobs_count)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const avgOpen90 =
      openInWindow.length > 0
        ? openInWindow.reduce((s, v) => s + v, 0) / openInWindow.length
        : null;
    const hiringSpikeIndicator =
      openJobsCount != null && avgOpen90 != null && avgOpen90 !== 0 ? openJobsCount / avgOpen90 : null;

    return {
      entityId: security.entity_id,
      securityId: security.id,
      ticker: security.ticker,
      securityName: security.name,
      openJobsCount,
      employeeCountEstimate,
      jobsPer100Employees,
      jobsGrowthRate30d,
      jobsGrowthRate90d,
      workforceGrowthRate90d,
      hiringSpikeIndicator,
      openJobsSource,
      employeeSource,
    };
  }

  async syncJobsFactors(input?: {
    asOfDate?: string | null;
    limit?: number | null;
    offset?: number | null;
    dryRun?: boolean;
  }): Promise<SyncJobsFactorsResult> {
    const asOfDate = this.parseAsOfDate(input?.asOfDate);
    const nowIso = new Date().toISOString();
    const dryRun = input?.dryRun === true;
    const limit = Math.max(1, Math.min(5000, input?.limit ?? 1000));
    const offset = Math.max(0, input?.offset ?? 0);

    const { data: securities, error: secErr } = await this.supabase()
      .from('securities')
      .select('id, entity_id, ticker, name, total_employees, linkedin_headcount_cache')
      .eq('active', true)
      .eq('market', 'stocks')
      .eq('locale', 'us')
      .not('entity_id', 'is', null)
      .order('ticker', { ascending: true })
      .range(offset, offset + limit - 1);
    if (secErr) {
      throw new ServiceUnavailableException(`Failed loading securities for jobs sync: ${secErr.message}`);
    }
    const rows = (securities ?? []) as JobsFactorSecurityRow[];
    const entityIds = [...new Set(rows.map((r) => r.entity_id))];
    const lookbackStart = (() => {
      const dt = new Date(`${asOfDate}T00:00:00.000Z`);
      dt.setUTCDate(dt.getUTCDate() - 120);
      return dt.toISOString().slice(0, 10);
    })();
    const historyByEntity = new Map<string, HistoricalJobsSnapshotRow[]>();
    if (entityIds.length > 0) {
      const { data: historyRows, error: histErr } = await this.supabase()
        .from('entity_jobs_metrics_snapshots')
        .select('entity_id, as_of_date, open_jobs_count, employee_count_estimate')
        .in('entity_id', entityIds)
        .gte('as_of_date', lookbackStart)
        .lte('as_of_date', asOfDate)
        .order('as_of_date', { ascending: true });
      if (histErr) {
        throw new ServiceUnavailableException(
          `Failed loading jobs history snapshots for CON-90: ${histErr.message}`,
        );
      }
      for (const row of (historyRows ?? []) as HistoricalJobsSnapshotRow[]) {
        const arr = historyByEntity.get(row.entity_id) ?? [];
        arr.push(row);
        historyByEntity.set(row.entity_id, arr);
      }
    }
    const openJobsByActorName = await this.countOpenJobsByActorCompanyName(rows);
    const openJobsByName = await this.countOpenJobsBySecurityName(rows);
    const metrics = rows.map((r) =>
      this.computeJobsMetricsForSecurity(r, openJobsByActorName, openJobsByName, historyByEntity, asOfDate),
    );

    if (dryRun) {
      return {
        asOfDate,
        scanned: rows.length,
        computed: metrics.length,
        persistedEntitySnapshots: 0,
        persistedCurrentFactors: 0,
        persistedTimeSeriesFactors: 0,
        dryRun: true,
      };
    }

    const { data: factors, error: factorsErr } = await this.supabase()
      .from('factors')
      .select('id, key')
      .in('key', [
        'open_jobs_count',
        'employee_count_estimate',
        'jobs_per_100_employees',
        'jobs_growth_rate_30d',
        'jobs_growth_rate_90d',
        'workforce_growth_rate_90d',
        'hiring_spike_indicator',
      ]);
    if (factorsErr) {
      throw new ServiceUnavailableException(`Failed loading factor ids: ${factorsErr.message}`);
    }
    const factorIdByKey = new Map(
      (factors ?? []).map((f: { id: string; key: string }) => [f.key as JobsFactorKey, f.id]),
    );
    for (const k of [
      'open_jobs_count',
      'employee_count_estimate',
      'jobs_per_100_employees',
      'jobs_growth_rate_30d',
      'jobs_growth_rate_90d',
      'workforce_growth_rate_90d',
      'hiring_spike_indicator',
    ] as JobsFactorKey[]) {
      if (!factorIdByKey.has(k)) {
        throw new ServiceUnavailableException(`Required factor missing: ${k}`);
      }
    }

    const snapshotRows = metrics.map((m) => ({
      entity_id: m.entityId,
      security_id: m.securityId,
      as_of_date: asOfDate,
      open_jobs_count: m.openJobsCount,
      employee_count_estimate: m.employeeCountEstimate,
      jobs_per_100_employees: m.jobsPer100Employees,
      open_jobs_source: m.openJobsSource,
      employee_count_source: m.employeeSource,
      source_payload: {
        ticker: m.ticker,
        security_name: m.securityName,
      },
      ingested_at: nowIso,
      updated_at: nowIso,
    }));

    const efvRows: Array<{
      entity_id: string;
      factor_id: string;
      model_version: string;
      period_key: string;
      period_months: number | null;
      value_num: number | null;
      source: string;
      ingested_at: string;
      updated_at: string;
    }> = [];
    const tsRows: Array<{
      entity_id: string;
      factor_id: string;
      model_version: string;
      period_key: string;
      period_months: number | null;
      value_num: number | null;
      as_of_date: string;
      source: string;
      ingested_at: string;
      start_date: string;
      end_date: string;
      period_of_report_date: string;
    }> = [];

    const addFactorRow = (m: ComputedJobsMetrics, key: JobsFactorKey, value: number | null) => {
      const factorId = factorIdByKey.get(key)!;
      efvRows.push({
        entity_id: m.entityId,
        factor_id: factorId,
        model_version: 'v1',
        period_key: 'na',
        period_months: null,
        value_num: value,
        source: 'jobs_pipeline',
        ingested_at: nowIso,
        updated_at: nowIso,
      });
      tsRows.push({
        entity_id: m.entityId,
        factor_id: factorId,
        model_version: 'v1',
        period_key: 'na',
        period_months: null,
        value_num: value,
        as_of_date: asOfDate,
        source: 'jobs_pipeline',
        ingested_at: nowIso,
        start_date: asOfDate,
        end_date: asOfDate,
        period_of_report_date: asOfDate,
      });
    };

    for (const m of metrics) {
      addFactorRow(m, 'open_jobs_count', m.openJobsCount);
      addFactorRow(m, 'employee_count_estimate', m.employeeCountEstimate);
      addFactorRow(m, 'jobs_per_100_employees', m.jobsPer100Employees);
      addFactorRow(m, 'jobs_growth_rate_30d', m.jobsGrowthRate30d);
      addFactorRow(m, 'jobs_growth_rate_90d', m.jobsGrowthRate90d);
      addFactorRow(m, 'workforce_growth_rate_90d', m.workforceGrowthRate90d);
      addFactorRow(m, 'hiring_spike_indicator', m.hiringSpikeIndicator);
    }

    const { data: upSnapshots, error: snapErr } = await this.supabase()
      .from('entity_jobs_metrics_snapshots')
      .upsert(snapshotRows, { onConflict: 'entity_id,as_of_date' })
      .select('id');
    if (snapErr) {
      throw new ServiceUnavailableException(`Failed persisting jobs snapshots: ${snapErr.message}`);
    }

    const { data: upEfv, error: efvErr } = await this.supabase()
      .from('entity_factor_values')
      .upsert(efvRows, { onConflict: 'entity_id,factor_id,model_version,period_key' })
      .select('entity_id');
    if (efvErr) {
      throw new ServiceUnavailableException(`Failed persisting entity_factor_values: ${efvErr.message}`);
    }

    const { data: upTs, error: tsErr } = await this.supabase()
      .from('entity_factor_values_ts')
      .upsert(tsRows, { onConflict: 'entity_id,factor_id,model_version,period_key,as_of_date' })
      .select('entity_id');
    if (tsErr) {
      throw new ServiceUnavailableException(`Failed persisting entity_factor_values_ts: ${tsErr.message}`);
    }

    return {
      asOfDate,
      scanned: rows.length,
      computed: metrics.length,
      persistedEntitySnapshots: (upSnapshots ?? []).length,
      persistedCurrentFactors: (upEfv ?? []).length,
      persistedTimeSeriesFactors: (upTs ?? []).length,
      dryRun: false,
    };
  }
}
