import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ListOrgEquitiesQueryDto } from './dto';

function hasCycleFilters(query: ListOrgEquitiesQueryDto): boolean {
  return (
    (query.sector_cycles?.length ?? 0) > 0 ||
    (query.industry_cycles?.length ?? 0) > 0 ||
    (query.sub_industry_cycles?.length ?? 0) > 0
  );
}

function isMissingCycleRpcError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('list_organization_equities_v2') ||
    m.includes('count_organization_equities_v2') ||
    m.includes('could not find the function') ||
    m.includes('42883')
  );
}

/** Stored under organizations.settings_json (SKE-78). */
export const EQUITY_DISPLAY_TAG_IDS_KEY = 'equity_display_tag_ids';

const DEFAULT_ORG_SLUG = 'default-organization';

/** PostgREST `.in('id', …)` stays small enough for URL limits. */
const SECURITIES_IN_CHUNK = 150;

/** Page size when scanning `security_tags` for distinct securities. */
const SECURITY_TAGS_PAGE = 1000;

function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface OrgEquityTagOption {
  tag_id: string;
  name: string;
  slug: string;
  group: string;
}

export interface OrgEquityRow {
  id: string;
  ticker: string;
  name: string;
  market_cap: number | null;
  primary_exchange: string | null;
  /** CON-50 (org side): 30d / 90d event metrics + trend from entity_factor_values. */
  positive_event_count_30d?: number | null;
  negative_event_count_30d?: number | null;
  positive_event_count_90d?: number | null;
  negative_event_count_90d?: number | null;
  event_pressure_30d?: number | null;
  event_pressure_90d?: number | null;
  event_pressure_trend?: number | null;
  sentiment_score?: number | null;
  /** CON-90 (jobs derived formulas) */
  jobs_per_100_employees?: number | null;
  jobs_growth_rate_30d?: number | null;
  jobs_growth_rate_90d?: number | null;
  workforce_growth_rate_90d?: number | null;
  hiring_spike_indicator?: number | null;
  /** Present when `list_organization_equities_v2` returns taxonomy display columns (migration 20260421130000). */
  sector_title?: string | null;
  industry_title?: string | null;
  sub_industry_title?: string | null;
  sector_cycle?: number | null;
  industry_cycle?: number | null;
  sub_industry_cycle?: number | null;
}

export interface OrgEquitiesListResult {
  items: OrgEquityRow[];
  has_more: boolean;
  offset: number;
  limit: number;
  /** Total rows matching current tag filter and search (independent of pagination). */
  total_count: number;
}

export interface OrgEquityDetailTag {
  tag_id: string;
  name: string;
  slug: string;
  group: string;
  source: string;
  confidence: number;
  as_of_date: string;
}

export interface OrgEquityDetailExposure {
  exposure_id: string;
  name: string;
  slug: string;
  category: string;
  polarity: number | null;
  direction: string;
  strength: number;
  confidence: number;
  source: string;
  as_of_date: string;
}

/** CON-120: verifiable evidence rows behind formula scores. */
export interface OrgEquityAnchorItem {
  id: string;
  kind: 'insider' | 'hedge_fund' | 'earnings' | 'macro';
  label: string;
  value: string;
  detail: string | null;
  as_of: string | null;
  source: string;
}

export interface OrgEquityAnchors {
  insider: OrgEquityAnchorItem[];
  hedge_fund: OrgEquityAnchorItem[];
  earnings: OrgEquityAnchorItem[];
  macro: OrgEquityAnchorItem[];
}

export interface OrgEquityDetails {
  security: {
    id: string;
    ticker: string;
    name: string;
    market: string;
    locale: string;
    primary_exchange: string | null;
    market_cap: number | null;
    description: string | null;
    homepage_url: string | null;
    total_employees: number | null;
    list_date: string | null;
    type_description: string | null;
  };
  taxonomy: {
    sector_title: string | null;
    industry_title: string | null;
    sub_industry_title: string | null;
    sector_cycle: number | null;
    industry_cycle: number | null;
    sub_industry_cycle: number | null;
  };
  scores: {
    fundamental_constriction_score: number | null;
    net_exposure_score: number | null;
    insider_conviction_score: number | null;
    political_score: number | null;
  };
  score_breakdowns: {
    fundamental_constriction_score: Record<string, unknown> | null;
    net_exposure_score: Record<string, unknown> | null;
    insider_conviction_score: Record<string, unknown> | null;
    political_score: Record<string, unknown> | null;
  };
  sentiment: {
    positive_event_count_30d: number | null;
    negative_event_count_30d: number | null;
    positive_event_count_90d: number | null;
    negative_event_count_90d: number | null;
    event_pressure_30d: number | null;
    event_pressure_90d: number | null;
    event_pressure_trend: number | null;
  };
  jobs: {
    jobs_per_100_employees: number | null;
    jobs_growth_rate_30d: number | null;
    jobs_growth_rate_90d: number | null;
    workforce_growth_rate_90d: number | null;
    hiring_spike_indicator: number | null;
  };
  /** Latest row per tag (by `as_of_date`, then insert order from query). */
  tags: OrgEquityDetailTag[];
  /** Latest row per exposure + direction. */
  exposures: OrgEquityDetailExposure[];
  /** CON-120 evidence anchors grouped by theme. */
  anchors: OrgEquityAnchors;
}

export interface OrgEquityTagFilterResponse {
  tag_ids: string[];
  tags: OrgEquityTagOption[];
}

@Injectable()
export class OrganizationEquitiesService {
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

  private parseStoredTagIds(settings: Record<string, unknown> | null | undefined): string[] {
    const raw = settings?.[EQUITY_DISPLAY_TAG_IDS_KEY];
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }

  private async loadOrganizationSettingsJson(
    organizationId: string,
  ): Promise<Record<string, unknown>> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('organizations')
      .select('settings_json')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Organization not found');
    }
    const s = data.settings_json;
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      return s as Record<string, unknown>;
    }
    return {};
  }

  async listPickableTags(organizationId: string): Promise<OrgEquityTagOption[]> {
    const client = this.requireClient();
    const defaultId = await this.resolveDefaultOrganizationId();
    const orgIds = defaultId ? [organizationId, defaultId] : [organizationId];
    const { data, error } = await client
      .from('tags')
      .select('tag_id, name, slug, group')
      .in('organization_id', orgIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data ?? []) as OrgEquityTagOption[];
  }

  async assertTagIdsAllowedForOrg(organizationId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) {
      return;
    }
    const client = this.requireClient();
    const defaultId = await this.resolveDefaultOrganizationId();
    const orgIds = defaultId ? [organizationId, defaultId] : [organizationId];
    const { data, error } = await client
      .from('tags')
      .select('tag_id')
      .in('tag_id', tagIds)
      .in('organization_id', orgIds)
      .eq('is_active', true);
    if (error) {
      throw new BadRequestException(error.message);
    }
    const found = new Set((data ?? []).map((r: { tag_id: string }) => r.tag_id));
    const missing = tagIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown or inactive tag(s) for this organization: ${missing.join(', ')}`,
      );
    }
  }

  async getEquityTagFilter(organizationId: string): Promise<OrgEquityTagFilterResponse> {
    const settings = await this.loadOrganizationSettingsJson(organizationId);
    const tag_ids = this.parseStoredTagIds(settings);
    if (tag_ids.length === 0) {
      return { tag_ids: [], tags: [] };
    }
    const client = this.requireClient();
    const { data, error } = await client
      .from('tags')
      .select('tag_id, name, slug, group')
      .in('tag_id', tag_ids)
      .eq('is_active', true);
    if (error) {
      throw new BadRequestException(error.message);
    }
    const rows = (data ?? []) as OrgEquityTagOption[];
    const order = new Map(tag_ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.tag_id) ?? 0) - (order.get(b.tag_id) ?? 0));
    return { tag_ids, tags: rows };
  }

  async setEquityTagFilter(
    organizationId: string,
    tagIds: string[],
  ): Promise<OrgEquityTagFilterResponse> {
    await this.assertTagIdsAllowedForOrg(organizationId, tagIds);
    const client = this.requireClient();
    const settings = await this.loadOrganizationSettingsJson(organizationId);
    const nextSettings = { ...settings, [EQUITY_DISPLAY_TAG_IDS_KEY]: tagIds };
    const { error } = await client
      .from('organizations')
      .update({ settings_json: nextSettings })
      .eq('id', organizationId);
    if (error) {
      throw new BadRequestException(error.message);
    }
    return this.getEquityTagFilter(organizationId);
  }

  private pickLatestTagsPerTagId(
    rows: {
      tag_id: string;
      source: string;
      confidence: number | string | null;
      as_of_date: string;
      tags:
        | { name: string; slug: string; group: string; is_active: boolean | null }
        | { name: string; slug: string; group: string; is_active: boolean | null }[]
        | null;
    }[],
  ): OrgEquityDetailTag[] {
    const seen = new Set<string>();
    const out: OrgEquityDetailTag[] = [];
    for (const r of rows) {
      const t = Array.isArray(r.tags) ? r.tags[0] ?? null : r.tags;
      if (!t || t.is_active === false) continue;
      if (seen.has(r.tag_id)) continue;
      seen.add(r.tag_id);
      const c = r.confidence;
      out.push({
        tag_id: r.tag_id,
        name: t.name,
        slug: t.slug,
        group: t.group,
        source: r.source,
        confidence: typeof c === 'string' ? Number(c) : (c ?? 0),
        as_of_date: r.as_of_date,
      });
    }
    out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    return out;
  }

  private pickLatestExposuresPerExposureAndDirection(
    rows: {
      exposure_id: string;
      direction: string;
      strength: number | string | null;
      confidence: number | string | null;
      source: string;
      as_of_date: string;
      exposures:
        | {
            name: string;
            slug: string;
            category: string;
            polarity: number | null;
          }
        | {
            name: string;
            slug: string;
            category: string;
            polarity: number | null;
          }[]
        | null;
    }[],
  ): OrgEquityDetailExposure[] {
    const seen = new Set<string>();
    const out: OrgEquityDetailExposure[] = [];
    for (const r of rows) {
      const e = Array.isArray(r.exposures) ? r.exposures[0] ?? null : r.exposures;
      if (!e) continue;
      const key = `${r.exposure_id}:${r.direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = r.strength;
      const c = r.confidence;
      out.push({
        exposure_id: r.exposure_id,
        name: e.name,
        slug: e.slug,
        category: e.category,
        polarity: e.polarity ?? null,
        direction: r.direction,
        strength: typeof s === 'string' ? Number(s) : (s ?? 0),
        confidence: typeof c === 'string' ? Number(c) : (c ?? 0),
        source: r.source,
        as_of_date: r.as_of_date,
      });
    }
    out.sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        a.name.localeCompare(b.name) ||
        a.direction.localeCompare(b.direction),
    );
    return out;
  }

  private fmtUsd(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return '—';
    const v = Math.abs(n);
    if (v >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  }

  private fmtNum(n: unknown, digits = 3): string {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    return String(Math.round(n * 10 ** digits) / 10 ** digits);
  }

  private async loadInsiderAnchorItems(
    client: ReturnType<OrganizationEquitiesService['requireClient']>,
    entityId: string | null,
  ): Promise<OrgEquityAnchorItem[]> {
    if (!entityId) return [];
    const { data: insiderRows } = await client
      .from('insiders')
      .select('id, role, title, person_entity_id')
      .eq('company_entity_id', entityId);
    if (!insiderRows?.length) return [];

    const insiderMeta = new Map<
      string,
      { role: string; title: string | null; person_entity_id: string }
    >();
    const personIds = new Set<string>();
    for (const r of insiderRows as {
      id: string;
      role: string;
      title: string | null;
      person_entity_id: string;
    }[]) {
      insiderMeta.set(r.id, r);
      personIds.add(r.person_entity_id);
    }

    const personNameById = new Map<string, string>();
    if (personIds.size > 0) {
      const { data: people } = await client
        .from('entities')
        .select('id, name')
        .in('id', [...personIds]);
      for (const p of (people ?? []) as { id: string; name: string | null }[]) {
        if (p.name) personNameById.set(p.id, p.name);
      }
    }

    const insiderIds = [...insiderMeta.keys()];
    const { data: tradeRows } = await client
      .from('insider_trades')
      .select(
        'id, insider_id, transaction_type, shares, value_usd, price_usd, trade_date, form_type, source',
      )
      .in('insider_id', insiderIds)
      .in('transaction_type', ['buy', 'sell'])
      .order('trade_date', { ascending: false })
      .limit(12);

    return ((tradeRows ?? []) as Record<string, unknown>[]).map((t) => {
      const meta = insiderMeta.get(String(t.insider_id));
      const person = meta ? personNameById.get(meta.person_entity_id) : null;
      const role = meta?.title?.trim() || meta?.role?.replace(/_/g, ' ') || 'Insider';
      const side = String(t.transaction_type ?? 'trade');
      const shares =
        typeof t.shares === 'number' ? t.shares : t.shares != null ? Number(t.shares) : null;
      const value =
        typeof t.value_usd === 'number'
          ? t.value_usd
          : t.value_usd != null
            ? Number(t.value_usd)
            : null;
      return {
        id: String(t.id),
        kind: 'insider' as const,
        label: `${side === 'buy' ? 'Buy' : 'Sell'} · ${role}`,
        value: value != null ? this.fmtUsd(value) : shares != null ? `${shares.toLocaleString()} sh` : '—',
        detail: person ?? null,
        as_of: t.trade_date != null ? String(t.trade_date) : null,
        source: t.form_type != null ? String(t.form_type) : String(t.source ?? 'SEC Form 4'),
      };
    });
  }

  private async loadFlowAnchorItems(
    client: ReturnType<OrganizationEquitiesService['requireClient']>,
    securityId: string,
    netBreakdown: Record<string, unknown> | null,
    politicalBreakdown: Record<string, unknown> | null,
  ): Promise<OrgEquityAnchorItem[]> {
    const out: OrgEquityAnchorItem[] = [];
    if (netBreakdown) {
      const tail = netBreakdown.tailwind;
      const head = netBreakdown.headwind;
      const rowsUsed = netBreakdown.rowsUsed;
      if (typeof tail === 'number') {
        out.push({
          id: 'net-tailwind',
          kind: 'hedge_fund',
          label: 'Theme tailwind (aggregate)',
          value: this.fmtNum(tail),
          detail: 'Positive structural alignment from exposures',
          as_of: netBreakdown.asOf != null ? String(netBreakdown.asOf) : null,
          source: 'Net exposure engine',
        });
      }
      if (typeof head === 'number') {
        out.push({
          id: 'net-headwind',
          kind: 'hedge_fund',
          label: 'Theme headwind (aggregate)',
          value: this.fmtNum(head),
          detail: 'Structural vulnerability from exposures',
          as_of: netBreakdown.asOf != null ? String(netBreakdown.asOf) : null,
          source: 'Net exposure engine',
        });
      }
      if (typeof rowsUsed === 'number') {
        out.push({
          id: 'net-rows-used',
          kind: 'hedge_fund',
          label: 'Exposure rows in score',
          value: String(rowsUsed),
          detail: null,
          as_of: netBreakdown.asOf != null ? String(netBreakdown.asOf) : null,
          source: 'Net exposure engine',
        });
      }
    }

    if (politicalBreakdown) {
      const buy = politicalBreakdown.buyPressure;
      const sell = politicalBreakdown.sellPressure;
      const trades = politicalBreakdown.tradesUsed;
      if (typeof buy === 'number') {
        out.push({
          id: 'political-buy-pressure',
          kind: 'hedge_fund',
          label: 'Congressional buy pressure',
          value: this.fmtUsd(buy),
          detail: 'Aggregated disclosure signal',
          as_of: politicalBreakdown.asOf != null ? String(politicalBreakdown.asOf) : null,
          source: 'Political score engine',
        });
      }
      if (typeof sell === 'number') {
        out.push({
          id: 'political-sell-pressure',
          kind: 'hedge_fund',
          label: 'Congressional sell pressure',
          value: this.fmtUsd(sell),
          detail: 'Aggregated disclosure signal',
          as_of: politicalBreakdown.asOf != null ? String(politicalBreakdown.asOf) : null,
          source: 'Political score engine',
        });
      }
      if (typeof trades === 'number') {
        out.push({
          id: 'political-trades-used',
          kind: 'hedge_fund',
          label: 'Congressional trades in window',
          value: String(trades),
          detail: null,
          as_of: politicalBreakdown.asOf != null ? String(politicalBreakdown.asOf) : null,
          source: 'Political score engine',
        });
      }
    }

    const { data: tradeRows } = await client
      .from('political_trades')
      .select('id, trade_date, side, value_usd, source, politicians ( name, chamber )')
      .eq('security_id', securityId)
      .order('trade_date', { ascending: false })
      .limit(8);

    for (const t of (tradeRows ?? []) as Record<string, unknown>[]) {
      const pol = Array.isArray(t.politicians) ? t.politicians[0] : t.politicians;
      const polObj = (pol ?? {}) as { name?: string | null; chamber?: string | null };
      const name = polObj.name?.trim() || 'Congressional filer';
      const chamber = polObj.chamber ? ` · ${polObj.chamber}` : '';
      const value =
        typeof t.value_usd === 'number'
          ? t.value_usd
          : t.value_usd != null
            ? Number(t.value_usd)
            : null;
      out.push({
        id: String(t.id),
        kind: 'hedge_fund',
        label: `${String(t.side ?? 'trade').toUpperCase()} disclosure`,
        value: value != null ? this.fmtUsd(value) : '—',
        detail: `${name}${chamber}`,
        as_of: t.trade_date != null ? String(t.trade_date) : null,
        source: String(t.source ?? 'Congressional disclosure'),
      });
    }
    return out;
  }

  private loadEarningsAnchorItems(
    fcBreakdown: Record<string, unknown> | null,
  ): OrgEquityAnchorItem[] {
    if (!fcBreakdown) return [];
    const out: OrgEquityAnchorItem[] = [];
    const raw = fcBreakdown.raw as Record<string, unknown> | undefined;
    const percentiles = fcBreakdown.percentiles as Record<string, unknown> | undefined;
    const labels: Record<string, string> = {
      epsAcceleration: 'EPS acceleration',
      marginExpansion: 'Margin expansion',
      roicImprovement: 'ROIC improvement',
      peCompression: 'P/E compression',
      debtImprovement: 'Balance sheet',
      fc_earnings_acceleration_pct: 'Earnings acceleration %ile',
      fc_margin_expansion_pct: 'Margin expansion %ile',
      fc_roic_improvement_pct: 'ROIC improvement %ile',
      fc_valuation_compression_pct: 'Valuation compression %ile',
      fc_balance_sheet_strength_pct: 'Balance sheet %ile',
    };
    if (raw) {
      for (const [k, v] of Object.entries(raw)) {
        out.push({
          id: `earnings-raw-${k}`,
          kind: 'earnings',
          label: labels[k] ?? k.replace(/([A-Z])/g, ' $1').trim(),
          value: this.fmtNum(v),
          detail: 'Raw fundamental signal',
          as_of: null,
          source: 'FMP / FC engine',
        });
      }
    }
    if (percentiles) {
      for (const [k, v] of Object.entries(percentiles)) {
        out.push({
          id: `earnings-pct-${k}`,
          kind: 'earnings',
          label: labels[k] ?? k.replace(/_/g, ' '),
          value: this.fmtNum(v),
          detail: 'Cross-sectional percentile',
          as_of: null,
          source: 'Fundamental constriction',
        });
      }
    }
    return out;
  }

  private loadMacroAnchorItems(exposures: OrgEquityDetailExposure[]): OrgEquityAnchorItem[] {
    return exposures.slice(0, 16).map((e) => ({
      id: `${e.exposure_id}-${e.direction}`,
      kind: 'macro' as const,
      label: e.name,
      value: `str ${this.fmtNum(e.strength)} · conf ${this.fmtNum(e.confidence)}`,
      detail: `${e.direction}${e.polarity != null ? ` · polarity ${e.polarity}` : ''} · ${e.category}`,
      as_of: e.as_of_date,
      source: e.source || 'Theme exposure',
    }));
  }

  async getEquityDetails(
    organizationId: string,
    securityId: string,
  ): Promise<OrgEquityDetails> {
    const client = this.requireClient();
    const { data: sec, error: secErr } = await client
      .from('securities')
      .select(
        'id, ticker, name, market, locale, primary_exchange, market_cap, description, homepage_url, total_employees, list_date, type_description, entity_id, active',
      )
      .eq('id', securityId)
      .maybeSingle();
    if (secErr) {
      throw new BadRequestException(secErr.message);
    }
    if (!sec) {
      throw new NotFoundException('Security not found');
    }
    if (!(sec.active && sec.market === 'stocks' && sec.locale === 'us')) {
      throw new NotFoundException('Security is not an active US stock');
    }

    const taxonomy = {
      sector_title: null as string | null,
      industry_title: null as string | null,
      sub_industry_title: null as string | null,
      sector_cycle: null as number | null,
      industry_cycle: null as number | null,
      sub_industry_cycle: null as number | null,
    };
    try {
      const { data: rows, error: rpcErr } = await client.rpc('list_organization_equities_v2', {
        p_tag_ids: null,
        p_search: sec.ticker,
        p_limit: 50,
        p_offset: 0,
        p_cycle_horizon: '24m',
        p_sector_cycles: null,
        p_industry_cycles: null,
        p_sub_industry_cycles: null,
      });
      if (rpcErr) {
        throw rpcErr;
      }
      const match = ((rows ?? []) as OrgEquityRow[]).find((r) => r.id === securityId);
      if (match) {
        taxonomy.sector_title = match.sector_title ?? null;
        taxonomy.industry_title = match.industry_title ?? null;
        taxonomy.sub_industry_title = match.sub_industry_title ?? null;
        taxonomy.sector_cycle = match.sector_cycle ?? null;
        taxonomy.industry_cycle = match.industry_cycle ?? null;
        taxonomy.sub_industry_cycle = match.sub_industry_cycle ?? null;
      }
    } catch {
      // Best effort only; details page still works if taxonomy RPC is unavailable.
    }

    const scores = {
      fundamental_constriction_score: null as number | null,
      net_exposure_score: null as number | null,
      insider_conviction_score: null as number | null,
      political_score: null as number | null,
    };
    const scoreBreakdowns = {
      fundamental_constriction_score: null as Record<string, unknown> | null,
      net_exposure_score: null as Record<string, unknown> | null,
      insider_conviction_score: null as Record<string, unknown> | null,
      political_score: null as Record<string, unknown> | null,
    };
    if (sec.entity_id) {
      const [formulaRes, scoreRes] = await Promise.all([
        client
          .from('formulas')
          .select('id, key')
          .in('key', [
            'fundamental_constriction_score',
            'net_exposure_score',
            'insider_conviction_score',
            'political_score',
          ]),
        client
          .from('entity_scores_current')
          .select('formula_id, score, explanation')
          .eq('entity_id', sec.entity_id),
      ]);
      if (formulaRes.error) {
        throw new BadRequestException(formulaRes.error.message);
      }
      if (scoreRes.error) {
        throw new BadRequestException(scoreRes.error.message);
      }
      const keyById = new Map(
        ((formulaRes.data ?? []) as { id: string; key: string }[]).map((f) => [f.id, f.key]),
      );
      for (const row of (scoreRes.data ?? []) as {
        formula_id: string;
        score: number | null;
        explanation: Record<string, unknown> | null;
      }[]) {
        const key = keyById.get(row.formula_id);
        if (!key) continue;
        const explanation = row.explanation ?? null;
        if (key === 'fundamental_constriction_score') {
          scores.fundamental_constriction_score = row.score;
          scoreBreakdowns.fundamental_constriction_score = explanation;
        } else if (key === 'net_exposure_score') {
          scores.net_exposure_score = row.score;
          scoreBreakdowns.net_exposure_score = explanation;
        } else if (key === 'insider_conviction_score') {
          scores.insider_conviction_score = row.score;
          scoreBreakdowns.insider_conviction_score = explanation;
        } else if (key === 'political_score') {
          scores.political_score = row.score;
          scoreBreakdowns.political_score = explanation;
        }
      }
    }

    const [enriched, tagsRes, exposuresRes] = await Promise.all([
      this.enrichRowsWithEventSentiment(client, [
        {
          id: sec.id,
          ticker: sec.ticker,
          name: sec.name,
          market_cap: sec.market_cap,
          primary_exchange: sec.primary_exchange,
        },
      ]),
      client
        .from('security_tags')
        .select('tag_id, source, confidence, as_of_date, tags ( name, slug, "group", is_active )')
        .eq('security_id', securityId)
        .order('as_of_date', { ascending: false }),
      client
        .from('security_exposures')
        .select(
          'exposure_id, direction, strength, confidence, source, as_of_date, exposures ( name, slug, category, polarity )',
        )
        .eq('security_id', securityId)
        .order('as_of_date', { ascending: false }),
    ]);
    if (tagsRes.error) {
      throw new BadRequestException(tagsRes.error.message);
    }
    if (exposuresRes.error) {
      throw new BadRequestException(exposuresRes.error.message);
    }
    const row = enriched[0];

    const tagRows = (tagsRes.data ?? []) as unknown as Parameters<
      OrganizationEquitiesService['pickLatestTagsPerTagId']
    >[0];
    const exposureRows = (exposuresRes.data ?? []) as unknown as Parameters<
      OrganizationEquitiesService['pickLatestExposuresPerExposureAndDirection']
    >[0];
    const exposures = this.pickLatestExposuresPerExposureAndDirection(exposureRows);

    return {
      security: {
        id: sec.id,
        ticker: sec.ticker,
        name: sec.name,
        market: sec.market,
        locale: sec.locale,
        primary_exchange: sec.primary_exchange,
        market_cap: sec.market_cap,
        description: sec.description ?? null,
        homepage_url: sec.homepage_url ?? null,
        total_employees: sec.total_employees ?? null,
        list_date: sec.list_date ?? null,
        type_description: sec.type_description ?? null,
      },
      taxonomy,
      scores,
      score_breakdowns: scoreBreakdowns,
      sentiment: {
        positive_event_count_30d: row?.positive_event_count_30d ?? null,
        negative_event_count_30d: row?.negative_event_count_30d ?? null,
        positive_event_count_90d: row?.positive_event_count_90d ?? null,
        negative_event_count_90d: row?.negative_event_count_90d ?? null,
        event_pressure_30d: row?.event_pressure_30d ?? null,
        event_pressure_90d: row?.event_pressure_90d ?? null,
        event_pressure_trend: row?.event_pressure_trend ?? null,
      },
      jobs: {
        jobs_per_100_employees: row?.jobs_per_100_employees ?? null,
        jobs_growth_rate_30d: row?.jobs_growth_rate_30d ?? null,
        jobs_growth_rate_90d: row?.jobs_growth_rate_90d ?? null,
        workforce_growth_rate_90d: row?.workforce_growth_rate_90d ?? null,
        hiring_spike_indicator: row?.hiring_spike_indicator ?? null,
      },
      tags: this.pickLatestTagsPerTagId(tagRows),
      exposures,
      anchors: {
        insider: await this.loadInsiderAnchorItems(client, sec.entity_id ?? null),
        hedge_fund: await this.loadFlowAnchorItems(
          client,
          securityId,
          scoreBreakdowns.net_exposure_score,
          scoreBreakdowns.political_score,
        ),
        earnings: this.loadEarningsAnchorItems(scoreBreakdowns.fundamental_constriction_score),
        macro: this.loadMacroAnchorItems(exposures),
      },
    };
  }

  /**
   * Lists equities via `list_organization_equities_v2` / `count_organization_equities_v2` (SKE-43),
   * with legacy `securities` / `security_tags` fallback when the migration is not applied and no
   * taxonomy cycle filters are requested.
   */
  async listEquities(
    organizationId: string,
    query: ListOrgEquitiesQueryDto,
  ): Promise<OrgEquitiesListResult> {
    if (query.from_securities) {
      return this.listEquitiesDirectFromSecurities(query);
    }
    const settings = await this.loadOrganizationSettingsJson(organizationId);
    const filterTagIds = this.parseStoredTagIds(settings);
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const client = this.requireClient();
    const search = query.q?.trim() || null;

    try {
      return await this.listEquitiesViaRpc(client, filterTagIds, search, limit, offset, query);
    } catch (e) {
      if (
        e instanceof BadRequestException &&
        !hasCycleFilters(query) &&
        isMissingCycleRpcError(e.message)
      ) {
        if (filterTagIds.length === 0) {
          return this.listEquitiesWithoutTagFilter(client, search, limit, offset, query);
        }
        return this.listEquitiesWithTagFilter(client, filterTagIds, search, limit, offset, query);
      }
      throw e;
    }
  }

  /**
   * Optional direct mode for admin screens: bypass org tag filter/RPC and read from `securities`.
   */
  private async listEquitiesDirectFromSecurities(
    query: ListOrgEquitiesQueryDto,
  ): Promise<OrgEquitiesListResult> {
    const client = this.requireClient();
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const search = query.q?.trim() || null;

    let countQ = client
      .from('securities')
      .select('*', { count: 'exact', head: true })
      .eq('active', true)
      .eq('market', 'stocks')
      .eq('locale', 'us');
    if (query.only_with_entity) {
      countQ = countQ.not('entity_id', 'is', null);
    }
    if (search) {
      const esc = escapeIlikePattern(search);
      countQ = countQ.or(`ticker.ilike.%${esc}%,name.ilike.%${esc}%`);
    }
    const { count: totalRaw, error: countErr } = await countQ;
    if (countErr) {
      throw new BadRequestException(countErr.message);
    }
    const total_count = totalRaw ?? 0;

    const take = limit + 1;
    let listQ = client
      .from('securities')
      .select('id, ticker, name, market_cap, primary_exchange')
      .eq('active', true)
      .eq('market', 'stocks')
      .eq('locale', 'us');
    if (query.only_with_entity) {
      listQ = listQ.not('entity_id', 'is', null);
    }
    if (search) {
      const esc = escapeIlikePattern(search);
      listQ = listQ.or(`ticker.ilike.%${esc}%,name.ilike.%${esc}%`);
    }
    const { data: rows, error: listErr } = await listQ
      .order('ticker', { ascending: true })
      .range(offset, offset + take - 1);
    if (listErr) {
      throw new BadRequestException(listErr.message);
    }
    const list = (rows ?? []) as OrgEquityRow[];
    const has_more = list.length > limit;
    const baseItems = has_more ? list.slice(0, limit) : list;
    const items = await this.enrichRowsWithEventSentiment(client, baseItems);
    return { items, has_more, offset, limit, total_count };
  }

  private async listEquitiesViaRpc(
    client: SupabaseClient,
    filterTagIds: string[],
    search: string | null,
    limit: number,
    offset: number,
    query: ListOrgEquitiesQueryDto,
  ): Promise<OrgEquitiesListResult> {
    const horizon = query.cycle_horizon ?? '24m';
    const toRpcArray = (arr?: number[]) => (arr && arr.length > 0 ? arr : null);

    const listArgs = {
      p_tag_ids: filterTagIds.length > 0 ? filterTagIds : null,
      p_search: search,
      p_limit: limit,
      p_offset: offset,
      p_cycle_horizon: horizon,
      p_sector_cycles: toRpcArray(query.sector_cycles),
      p_industry_cycles: toRpcArray(query.industry_cycles),
      p_sub_industry_cycles: toRpcArray(query.sub_industry_cycles),
    };

    const countArgs = {
      p_tag_ids: listArgs.p_tag_ids,
      p_search: listArgs.p_search,
      p_cycle_horizon: horizon,
      p_sector_cycles: toRpcArray(query.sector_cycles),
      p_industry_cycles: toRpcArray(query.industry_cycles),
      p_sub_industry_cycles: toRpcArray(query.sub_industry_cycles),
    };

    const [listRes, countRes] = await Promise.all([
      client.rpc('list_organization_equities_v2', listArgs),
      client.rpc('count_organization_equities_v2', countArgs),
    ]);

    if (listRes.error) {
      if (hasCycleFilters(query) && isMissingCycleRpcError(listRes.error.message)) {
        throw new BadRequestException(
          'Taxonomy cycle filters require database migration 20260414120000_org_equities_taxonomy_cycle_filters.sql to be applied.',
        );
      }
      throw new BadRequestException(listRes.error.message);
    }
    if (countRes.error) {
      if (hasCycleFilters(query) && isMissingCycleRpcError(countRes.error.message)) {
        throw new BadRequestException(
          'Taxonomy cycle filters require database migration 20260414120000_org_equities_taxonomy_cycle_filters.sql to be applied.',
        );
      }
      throw new BadRequestException(countRes.error.message);
    }

    const rows = (listRes.data ?? []) as OrgEquityRow[];
    const totalRaw = countRes.data as unknown;
    const total_count =
      typeof totalRaw === 'bigint'
        ? Number(totalRaw)
        : typeof totalRaw === 'number' && !Number.isNaN(totalRaw)
          ? totalRaw
          : Number(totalRaw ?? 0);

    const has_more = rows.length > limit;
    const baseItems = has_more ? rows.slice(0, limit) : rows;
    const eligibleItems = query.only_with_entity
      ? await this.filterItemsWithEntityId(client, baseItems)
      : baseItems;
    const items = await this.enrichRowsWithEventSentiment(client, eligibleItems);
    return { items, has_more, offset, limit, total_count };
  }

  private async listEquitiesWithoutTagFilter(
    client: SupabaseClient,
    search: string | null,
    limit: number,
    offset: number,
    query: ListOrgEquitiesQueryDto,
  ): Promise<OrgEquitiesListResult> {
    const take = limit + 1;

    let countQ = client
      .from('securities')
      .select('*', { count: 'exact', head: true })
      .eq('active', true)
      .eq('market', 'stocks')
      .eq('locale', 'us');
    if (search) {
      const esc = escapeIlikePattern(search);
      countQ = countQ.or(`ticker.ilike.%${esc}%,name.ilike.%${esc}%`);
    }
    const { count: totalRaw, error: countErr } = await countQ;
    if (countErr) {
      throw new BadRequestException(countErr.message);
    }
    const total_count = totalRaw ?? 0;

    let listQ = client
      .from('securities')
      .select('id, ticker, name, market_cap, primary_exchange')
      .eq('active', true)
      .eq('market', 'stocks')
      .eq('locale', 'us');
    if (search) {
      const esc = escapeIlikePattern(search);
      listQ = listQ.or(`ticker.ilike.%${esc}%,name.ilike.%${esc}%`);
    }
    const { data: rows, error: listErr } = await listQ
      .order('ticker', { ascending: true })
      .range(offset, offset + take - 1);
    if (listErr) {
      throw new BadRequestException(listErr.message);
    }
    const list = (rows ?? []) as OrgEquityRow[];
    const has_more = list.length > limit;
    const baseItems = has_more ? list.slice(0, limit) : list;
    const eligibleItems = query.only_with_entity
      ? await this.filterItemsWithEntityId(client, baseItems)
      : baseItems;
    const items = await this.enrichRowsWithEventSentiment(client, eligibleItems);
    return { items, has_more, offset, limit, total_count };
  }

  private async collectSecurityIdsForTags(
    client: SupabaseClient,
    tagIds: string[],
  ): Promise<string[]> {
    const idSet = new Set<string>();
    let from = 0;
    for (;;) {
      const { data, error } = await client
        .from('security_tags')
        .select('security_id')
        .in('tag_id', tagIds)
        .range(from, from + SECURITY_TAGS_PAGE - 1);
      if (error) {
        throw new BadRequestException(error.message);
      }
      const batch = data ?? [];
      for (const r of batch as { security_id: string }[]) {
        idSet.add(r.security_id);
      }
      if (batch.length < SECURITY_TAGS_PAGE) {
        break;
      }
      from += SECURITY_TAGS_PAGE;
    }
    return [...idSet];
  }

  private async countSecuritiesInChunks(
    client: SupabaseClient,
    securityIds: string[],
    search: string | null,
  ): Promise<number> {
    let total = 0;
    for (const part of chunkArray(securityIds, SECURITIES_IN_CHUNK)) {
      let q = client
        .from('securities')
        .select('id', { count: 'exact', head: true })
        .in('id', part)
        .eq('active', true)
        .eq('market', 'stocks')
        .eq('locale', 'us');
      if (search) {
        const esc = escapeIlikePattern(search);
        q = q.or(`ticker.ilike.%${esc}%,name.ilike.%${esc}%`);
      }
      const { count, error } = await q;
      if (error) {
        throw new BadRequestException(error.message);
      }
      total += count ?? 0;
    }
    return total;
  }

  private async listEquitiesWithTagFilter(
    client: SupabaseClient,
    tagIds: string[],
    search: string | null,
    limit: number,
    offset: number,
    query: ListOrgEquitiesQueryDto,
  ): Promise<OrgEquitiesListResult> {
    const securityIds = await this.collectSecurityIdsForTags(client, tagIds);
    if (securityIds.length === 0) {
      return { items: [], has_more: false, offset, limit, total_count: 0 };
    }

    const total_count = await this.countSecuritiesInChunks(client, securityIds, search);

    const light: { id: string; ticker: string }[] = [];
    for (const part of chunkArray(securityIds, SECURITIES_IN_CHUNK)) {
      let q = client
        .from('securities')
        .select('id, ticker')
        .in('id', part)
        .eq('active', true)
        .eq('market', 'stocks')
        .eq('locale', 'us');
      if (search) {
        const esc = escapeIlikePattern(search);
        q = q.or(`ticker.ilike.%${esc}%,name.ilike.%${esc}%`);
      }
      const { data, error } = await q;
      if (error) {
        throw new BadRequestException(error.message);
      }
      light.push(...((data ?? []) as { id: string; ticker: string }[]));
    }
    light.sort((a, b) => a.ticker.localeCompare(b.ticker, undefined, { sensitivity: 'base' }));

    const window = light.slice(offset, offset + limit + 1);
    const has_more = window.length > limit;
    const pageLight = has_more ? window.slice(0, limit) : window;
    const pageIds = pageLight.map((r) => r.id);

    if (pageIds.length === 0) {
      return { items: [], has_more: false, offset, limit, total_count };
    }

    const { data: fullRows, error: fullErr } = await client
      .from('securities')
      .select('id, ticker, name, market_cap, primary_exchange')
      .in('id', pageIds);
    if (fullErr) {
      throw new BadRequestException(fullErr.message);
    }
    const byId = new Map(
      ((fullRows ?? []) as OrgEquityRow[]).map((r) => [r.id, r]),
    );
    const baseItems = pageIds.map((id) => byId.get(id)).filter((r): r is OrgEquityRow => r != null);
    const eligibleItems = query.only_with_entity
      ? await this.filterItemsWithEntityId(client, baseItems)
      : baseItems;
    const items = await this.enrichRowsWithEventSentiment(client, eligibleItems);

    return { items, has_more, offset, limit, total_count };
  }

  private async filterItemsWithEntityId(
    client: SupabaseClient,
    items: OrgEquityRow[],
  ): Promise<OrgEquityRow[]> {
    if (items.length === 0) return items;
    const securityIds = items.map((r) => r.id);
    const { data, error } = await client
      .from('securities')
      .select('id, entity_id')
      .in('id', securityIds)
      .not('entity_id', 'is', null);
    if (error) {
      throw new BadRequestException(error.message);
    }
    const allowed = new Set(
      ((data ?? []) as { id: string }[]).map((r) => r.id),
    );
    return items.filter((r) => allowed.has(r.id));
  }

  private async enrichRowsWithEventSentiment(
    client: SupabaseClient,
    items: OrgEquityRow[],
  ): Promise<OrgEquityRow[]> {
    if (items.length === 0) return items;
    const securityIds = items.map((r) => r.id);
    const { data: securities, error: secErr } = await client
      .from('securities')
      .select('id, entity_id')
      .in('id', securityIds);
    if (secErr) throw new BadRequestException(secErr.message);

    const entityBySecurityId = new Map<string, string>();
    const entityIds: string[] = [];
    for (const row of (securities ?? []) as { id: string; entity_id: string | null }[]) {
      if (row.entity_id) {
        entityBySecurityId.set(row.id, row.entity_id);
        entityIds.push(row.entity_id);
      }
    }
    if (entityIds.length === 0) return items;

    const factorKeys = [
      'positive_event_count',
      'negative_event_count',
      'event_pressure',
      'event_pressure_trend',
      'positive_event_count_30d',
      'negative_event_count_30d',
      'event_pressure_30d',
      'positive_event_count_90d',
      'negative_event_count_90d',
      'event_pressure_90d',
      'jobs_per_100_employees',
      'jobs_growth_rate_30d',
      'jobs_growth_rate_90d',
      'workforce_growth_rate_90d',
      'hiring_spike_indicator',
    ] as const;
    const { data: factors, error: facErr } = await client
      .from('factors')
      .select('id, key')
      .in('key', [...factorKeys]);
    if (facErr) throw new BadRequestException(facErr.message);
    const factorIdToKey = new Map<string, string>();
    for (const f of (factors ?? []) as { id: string; key: string }[]) factorIdToKey.set(f.id, f.key);
    if (factorIdToKey.size === 0) return items;

    const factorIds = [...factorIdToKey.keys()];
    const { data: efv, error: efvErr } = await client
      .from('entity_factor_values')
      .select('entity_id, factor_id, period_key, value_num')
      .eq('model_version', 'v1')
      .in('entity_id', entityIds)
      .in('factor_id', factorIds)
      .in('period_key', ['30d', '90d', '1m', '3m', 'na']);
    if (efvErr) throw new BadRequestException(efvErr.message);

    const byEntity = new Map<string, Record<string, number>>();
    for (const row of (efv ?? []) as {
      entity_id: string;
      factor_id: string;
      period_key: string;
      value_num: number | null;
    }[]) {
      if (row.value_num == null) continue;
      const factorKey = factorIdToKey.get(row.factor_id);
      if (!factorKey) continue;
      const k = `${factorKey}:${row.period_key}`;
      const rec = byEntity.get(row.entity_id) ?? {};
      rec[k] = row.value_num;
      byEntity.set(row.entity_id, rec);
    }

    return items.map((row) => {
      const entityId = entityBySecurityId.get(row.id);
      const rec = entityId ? byEntity.get(entityId) : undefined;
      const trend = rec?.['event_pressure_trend:na'] ?? null;
      const positive30 =
        rec?.['positive_event_count_30d:30d'] ?? rec?.['positive_event_count:30d'] ?? rec?.['positive_event_count:1m'] ?? null;
      const negative30 =
        rec?.['negative_event_count_30d:30d'] ?? rec?.['negative_event_count:30d'] ?? rec?.['negative_event_count:1m'] ?? null;
      const positive90 =
        rec?.['positive_event_count_90d:90d'] ?? rec?.['positive_event_count:90d'] ?? rec?.['positive_event_count:3m'] ?? null;
      const negative90 =
        rec?.['negative_event_count_90d:90d'] ?? rec?.['negative_event_count:90d'] ?? rec?.['negative_event_count:3m'] ?? null;
      const pressure30 =
        rec?.['event_pressure_30d:30d'] ?? rec?.['event_pressure:30d'] ?? rec?.['event_pressure:1m'] ?? null;
      const pressure90 =
        rec?.['event_pressure_90d:90d'] ?? rec?.['event_pressure:90d'] ?? rec?.['event_pressure:3m'] ?? null;
      return {
        ...row,
        positive_event_count_30d: positive30,
        negative_event_count_30d: negative30,
        positive_event_count_90d: positive90,
        negative_event_count_90d: negative90,
        event_pressure_30d: pressure30,
        event_pressure_90d: pressure90,
        event_pressure_trend: trend,
        sentiment_score: trend,
        jobs_per_100_employees: rec?.['jobs_per_100_employees:na'] ?? null,
        jobs_growth_rate_30d: rec?.['jobs_growth_rate_30d:na'] ?? null,
        jobs_growth_rate_90d: rec?.['jobs_growth_rate_90d:na'] ?? null,
        workforce_growth_rate_90d: rec?.['workforce_growth_rate_90d:na'] ?? null,
        hiring_spike_indicator: rec?.['hiring_spike_indicator:na'] ?? null,
      };
    });
  }
}
