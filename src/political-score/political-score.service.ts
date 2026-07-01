import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CongressService } from '../congress/congress.service';
import { FmpService } from '../fmp/fmp.service';
import {
  canonicalPersonKey,
  canonicalPersonKeyRelaxed,
  clusterScore,
  committeeRelevanceForTrade,
  congressNumberForTradeDate,
  maxInfluenceScore,
  parseFmpTransactionDate,
  parseTradeSide,
  parseUsdMidpoint,
  CLUSTER_WINDOW_DAYS,
  POLITICAL_WINDOW_DAYS,
  politicalScoreFromPressures,
  PS_WEIGHTS,
  type PoliticalTradeWeights,
  recencyScore,
  tradeScoreFromFactors,
  tradeSizeScore,
  type CommitteeRole,
} from './political-score-factors';

/** Extra history so 90d cluster counts are complete for trades inside the 180d window. */
const TRADE_FETCH_EXTRA_DAYS = CLUSTER_WINDOW_DAYS;

const MAX_TARGETS = 500;
const SYNC_PAGE_LIMIT = 100;
const MAX_SYNC_PAGES = 24;

/** How many distinct values to list in FMP sync “details” lines (per category). */
const FMP_SYNC_DETAIL_TOP_SYMBOLS = 35;
const FMP_SYNC_DETAIL_MAX_FILER_LABELS = 28;
const FMP_SYNC_DETAIL_MAX_RAW_TYPES = 22;
const FMP_SYNC_DETAIL_MAX_DUP_KEYS = 18;
const FMP_SYNC_LABEL_MAX_LEN = 96;

function truncateSyncLabel(s: string, max = FMP_SYNC_LABEL_MAX_LEN): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatTopCountMap(
  counts: Map<string, number>,
  topN: number,
  uniqueLabel: string,
): string {
  if (counts.size === 0) return '';
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, topN);
  const parts = top.map(([k, v]) => `${k} (${v})`);
  const more =
    entries.length > topN ? ` … and ${entries.length - topN} more ${uniqueLabel}` : '';
  return `${entries.length} unique ${uniqueLabel}. Top ${Math.min(topN, entries.length)}: ${parts.join(', ')}${more}`;
}

/** Short label for an FMP row that failed politician match (for sync diagnostics). */
function filerSkipLabel(row: Record<string, unknown>): string {
  const candidates = fmpNameCandidates(row);
  const name = buildPersonName(row) || candidates[0] || '';
  const bg = fmpBioguideFromRow(row);
  const spouse = fmpOwnershipLooksSpouseOrDependent(row) ? ' [spouse/dependent]' : '';
  if (name && bg) return truncateSyncLabel(`${name} [bioguide=${bg}]${spouse}`);
  if (name) return truncateSyncLabel(`${name}${spouse}`);
  if (bg) return truncateSyncLabel(`[bioguide=${bg}]${spouse}`);
  return '(no name/bioguide)';
}

const PS_MODEL_VERSION = 'v1';
const PS_PERIOD_KEY = 'political_180d';

const PS_FACTOR_KEYS = [
  'ps_committee_relevance_pct',
  'ps_trade_size_pct',
  'ps_recency_pct',
  'ps_influence_pct',
  'ps_cluster_pct',
] as const;

export interface PoliticalScoreRow {
  ticker: string;
  security_id: string;
  score: number;
  rank: number | null;
  buyPressure: number;
  sellPressure: number;
  tradesUsed: number;
}

export interface PoliticalScoreCalculateResult {
  tickersRequested: number;
  tickersWithData: number;
  scoresWritten: number;
  tradesSynced: number;
  /** Informational FMP sync stats (not failures). */
  syncNotes: { ticker: string; message: string }[];
  /** True failures and actionable diagnostics. */
  errors: { ticker: string; message: string }[];
  scores: PoliticalScoreRow[];
  /** Rows in political_trades used after the 180d recency filter (approximate). */
  tradesUsedInScoring: number;
}

type PoliticalTradeRow = {
  id: string;
  politician_id: string;
  security_id: string;
  trade_date: string;
  side: 'buy' | 'sell';
  value_usd: number | null;
};

function fmpParseArray(data: unknown): Record<string, unknown>[] | null {
  if (data == null) return null;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null && 'Error Message' in data) {
    return null;
  }
  return null;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function buildPersonName(row: Record<string, unknown>): string {
  const fn = str(row.firstName ?? row.first_name);
  const ln = str(row.lastName ?? row.last_name);
  if (fn && ln) return `${fn} ${ln}`;
  const full = str(
    row.name ?? row.senator ?? row.representative ?? row.officer ?? row.fullName,
  );
  return full;
}

/** FMP disclosure name fields — union of stable + alternate payload keys. */
function fmpNameCandidates(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim();
    if (t.length < 2) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  const fn = str(row.firstName ?? row.first_name);
  const ln = str(row.lastName ?? row.last_name);
  if (fn && ln) {
    add(`${fn} ${ln}`);
    add(`${ln}, ${fn}`);
  }
  const built = buildPersonName(row);
  if (built) add(built);
  for (const field of [
    row.name,
    row.senator,
    row.representative,
    row.officer,
    row.fullName,
    row.memberName,
    row.filerName,
    row.politicianName,
    row.representativeName,
    row.senatorName,
    row.personName,
    row.officerName,
    row.filer,
  ]) {
    add(str(field));
  }
  return out;
}

/** Lowercase `lastname|firstname` (letters only) for direct FMP first/last ↔ DB match. */
function lastFirstKey(first: string, last: string): string {
  const ft = (first.trim().split(/\s+/)[0] ?? '').replace(/\.$/, '');
  const f = ft.toLowerCase().replace(/[^a-z]/g, '');
  const l = last.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!f || !l) return '';
  return `${l}|${f}`;
}

type PolMatchRow = {
  id: string;
  name_full: string | null;
  bioguide_id: string | null;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  is_current_member: boolean | null;
};

type MatchMethod =
  | 'direct_bioguide'
  | 'deterministic_house'
  | 'deterministic_senate'
  | 'name_fallback';

type ParsedDistrict = {
  state: string;
  district: number;
};

type CongressMemberCandidate = {
  bioguideId: string;
  firstName: string;
  lastName: string;
  name: string;
  chamberHint?: string;
};

function addPolToKeyMap(map: Map<string, PolMatchRow[]>, key: string, pol: PolMatchRow) {
  if (!key) return;
  const list = map.get(key) ?? [];
  if (!list.some((p) => p.id === pol.id)) list.push(pol);
  map.set(key, list);
}

/** When multiple politicians share a key, prefer a single current member; else treat as ambiguous. */
function pickUniquePol(list: PolMatchRow[] | undefined): PolMatchRow | undefined {
  if (!list?.length) return undefined;
  if (list.length === 1) return list[0];
  const cur = list.filter((p) => p.is_current_member);
  if (cur.length === 1) return cur[0];
  return undefined;
}

function registerPoliticianMatchKeys(
  pol: PolMatchRow,
  byCanon: Map<string, PolMatchRow[]>,
  byRelaxed: Map<string, PolMatchRow[]>,
  byLastFirst: Map<string, PolMatchRow[]>,
) {
  const names: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t.length >= 2) names.push(t);
  };
  const nf = (pol.name_full ?? '').trim();
  if (nf) add(nf);
  const fn = (pol.first_name ?? '').trim();
  const ln = (pol.last_name ?? '').trim();
  if (fn && ln) add(`${fn} ${ln}`);
  const nn = (pol.nickname ?? '').trim();
  if (nn && ln) add(`${nn} ${ln}`);

  const uniq = [...new Set(names)];
  for (const n of uniq) {
    const c = canonicalPersonKey(n);
    if (c) addPolToKeyMap(byCanon, c, pol);
    const r = canonicalPersonKeyRelaxed(n);
    if (r) addPolToKeyMap(byRelaxed, r, pol);
  }
  if (fn && ln) {
    const k = lastFirstKey(fn, ln);
    if (k) addPolToKeyMap(byLastFirst, k, pol);
    if (nn && ln) {
      const k2 = lastFirstKey(nn, ln);
      if (k2) addPolToKeyMap(byLastFirst, k2, pol);
    }
  }
}

function fmpBioguideFromRow(row: Record<string, unknown>): string {
  return str(
    row.bioguideId ??
      row.bioguide_id ??
      row.bioguide ??
      row.memberBioguideId ??
      row.bioguideID ??
      row.memberBioguideID,
  ).toUpperCase();
}

function matchFmpRowToPolitician(
  row: Record<string, unknown>,
  ctx: {
    byBioguide: Map<string, PolMatchRow>;
    byCanon: Map<string, PolMatchRow[]>;
    byRelaxed: Map<string, PolMatchRow[]>;
    byLastFirst: Map<string, PolMatchRow[]>;
    byLastNameUnique: Map<string, PolMatchRow>;
  },
): PolMatchRow | undefined {
  const bg = fmpBioguideFromRow(row);
  if (bg && ctx.byBioguide.has(bg)) return ctx.byBioguide.get(bg);

  for (const name of fmpNameCandidates(row)) {
    const c = canonicalPersonKey(name);
    const p = pickUniquePol(ctx.byCanon.get(c));
    if (p) return p;
    const r = canonicalPersonKeyRelaxed(name);
    const p2 = pickUniquePol(ctx.byRelaxed.get(r));
    if (p2) return p2;
  }

  const fn = str(row.firstName ?? row.first_name);
  const ln = str(row.lastName ?? row.last_name);
  if (fn && ln) {
    const k = lastFirstKey(fn, ln);
    const p3 = pickUniquePol(ctx.byLastFirst.get(k));
    if (p3) return p3;
  }

  if (!fmpOwnershipLooksSpouseOrDependent(row)) {
    const fmpLn = str(row.lastName ?? row.last_name)
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    if (fmpLn && ctx.byLastNameUnique.has(fmpLn)) {
      return ctx.byLastNameUnique.get(fmpLn);
    }
  }
  return undefined;
}

function hashExternalId(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40);
}

/** Last word of display name, ignoring Jr/Sr/III suffixes — for unique last-name match. */
function lastNameTokenFromFullName(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  let last = parts[parts.length - 1]!.toLowerCase().replace(/[^a-z]/g, '');
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
  if (suffixes.has(last) && parts.length >= 2) {
    last = parts[parts.length - 2]!.toLowerCase().replace(/[^a-z]/g, '');
  }
  return last;
}

function fmpOwnershipLooksSpouseOrDependent(row: Record<string, unknown>): boolean {
  const o = str(row.ownershipType ?? row.owner ?? '').toLowerCase();
  return /spouse|husband|wife|child|dependent|son|daughter/i.test(o);
}

function normalizeAlpha(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

function parseStateDistrict(raw: string): ParsedDistrict | null {
  const t = raw.trim().toUpperCase();
  const m = t.match(/^([A-Z]{2})[-\s]?(\d{1,2})$/);
  if (!m) return null;
  const district = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(district) || district < 0) return null;
  return { state: m[1]!, district };
}

function rowStateDistrict(row: Record<string, unknown>): ParsedDistrict | null {
  const candidates = [
    row.stateDistrict,
    row.state_district,
    row.State_District,
    row.stateAndDistrict,
    row.state_and_district,
  ];
  for (const c of candidates) {
    const p = parseStateDistrict(str(c));
    if (p) return p;
  }
  return null;
}

function rowStateCode(row: Record<string, unknown>): string {
  const sd = rowStateDistrict(row);
  if (sd) return sd.state;
  return str(row.state ?? row.stateCode ?? row.state_code).toUpperCase();
}

function rowChamberHint(row: Record<string, unknown>, source: string): 'house' | 'senate' | '' {
  if (source === 'fmp_house') return 'house';
  if (source === 'fmp_senate') return 'senate';
  const raw = str(row.house ?? row.chamber ?? row.office).toLowerCase();
  if (raw.includes('house')) return 'house';
  if (raw.includes('senate') || raw.includes('senator')) return 'senate';
  return '';
}

function normalizeMemberCandidates(
  members: unknown[],
  chamberHint?: string,
): CongressMemberCandidate[] {
  const out: CongressMemberCandidate[] = [];
  for (const m of members) {
    const row = m as Record<string, unknown>;
    const bioguideId = str(row.bioguideId ?? row.bioguide_id).toUpperCase();
    if (!bioguideId) continue;
    const firstName = str(row.firstName ?? row.first_name);
    const lastName = str(row.lastName ?? row.last_name);
    const name = str(row.name ?? `${firstName} ${lastName}`);
    out.push({ bioguideId, firstName, lastName, name, chamberHint });
  }
  return out;
}

function pickDeterministicCandidate(
  row: Record<string, unknown>,
  candidates: CongressMemberCandidate[],
): CongressMemberCandidate | undefined {
  if (!candidates.length) return undefined;
  const fn = normalizeAlpha(str(row.firstName ?? row.first_name));
  const ln = normalizeAlpha(str(row.lastName ?? row.last_name));
  if (fn && ln) {
    const exact = candidates.filter(
      (c) =>
        normalizeAlpha(c.firstName).startsWith(fn) &&
        normalizeAlpha(c.lastName) === ln,
    );
    if (exact.length === 1) return exact[0];
  }
  const names = fmpNameCandidates(row).map(normalizeAlpha).filter(Boolean);
  if (names.length) {
    const byName = candidates.filter((c) => {
      const nm = normalizeAlpha(c.name);
      return names.some((n) => nm.includes(n) || n.includes(nm));
    });
    if (byName.length === 1) return byName[0];
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function resolveSecurityId(
  secByTicker: Map<string, string>,
  rawSymbol: string,
): string | undefined {
  const sym = rawSymbol.trim().toUpperCase();
  let id = secByTicker.get(sym);
  if (id) return id;
  if (sym.includes('.')) id = secByTicker.get(sym.replace(/\./g, '-'));
  if (id) return id;
  if (sym.includes('-')) id = secByTicker.get(sym.replace(/-/g, '.'));
  return id;
}

const SECURITIES_PAGE_SIZE = 1000;

@Injectable()
export class PoliticalScoreService {
  private readonly logger = new Logger(PoliticalScoreService.name);
  private adminClient: SupabaseClient | null = null;
  private readonly deterministicMemberCache = new Map<string, CongressMemberCandidate[]>();

  constructor(
    private config: ConfigService,
    private readonly fmpService: FmpService,
    private readonly congressService: CongressService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  /** Maps `formulas.definition.weights` (factor keys) to tradeScoreFromFactors shape. */
  private politicalTradeWeightsFromDefinition(definition: unknown): PoliticalTradeWeights {
    const w = (definition as { weights?: Record<string, number> } | null)?.weights;
    const d = {
      committee: PS_WEIGHTS.committee,
      size: PS_WEIGHTS.size,
      recency: PS_WEIGHTS.recency,
      influence: PS_WEIGHTS.influence,
      cluster: PS_WEIGHTS.cluster,
    };
    if (!w) return { ...d };
    const n = (v: unknown, fb: number) =>
      typeof v === 'number' && Number.isFinite(v) ? v : fb;
    return {
      committee: n(w.ps_committee_relevance_pct, d.committee),
      size: n(w.ps_trade_size_pct, d.size),
      recency: n(w.ps_recency_pct, d.recency),
      influence: n(w.ps_influence_pct, d.influence),
      cluster: n(w.ps_cluster_pct, d.cluster),
    };
  }

  private getApiKey(): string | undefined {
    return (
      this.config.get<string>('fmp.apiKey') ??
      this.config.get<string>('FMP_API_KEY') ??
      process.env.FMP_API_KEY
    );
  }

  private getBaseUrl(): string {
    return (
      this.config.get<string>('fmp.baseUrl') ??
      process.env.FMP_API_BASE_URL ??
      'https://financialmodelingprep.com'
    ).replace(/\/$/, '');
  }

  /** Paginated — PostgREST often caps a single select (~1000 rows). */
  private async loadActiveSecuritiesTickerMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!this.adminClient) return map;
    let from = 0;
    while (true) {
      const { data, error } = await this.adminClient
        .from('securities')
        .select('id, ticker')
        .eq('active', true)
        .range(from, from + SECURITIES_PAGE_SIZE - 1);
      if (error) {
        this.logger.warn(`loadActiveSecuritiesTickerMap: ${error.message}`);
        break;
      }
      const rows = data ?? [];
      for (const s of rows) {
        const r = s as { id: string; ticker: string };
        map.set(r.ticker.trim().toUpperCase(), r.id);
      }
      if (rows.length < SECURITIES_PAGE_SIZE) break;
      from += SECURITIES_PAGE_SIZE;
    }
    return map;
  }

  private async fmpGetRaw(path: string): Promise<unknown> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('FMP_API_KEY not configured');
      return null;
    }
    const sep = path.includes('?') ? '&' : '?';
    const url = `${this.getBaseUrl()}${path}${sep}apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      this.logger.warn(`FMP ${path} -> ${res.status}`);
      return null;
    }
    if (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      'Error Message' in data
    ) {
      return null;
    }
    return data;
  }

  private async resolveCandidatesByStateDistrict(
    state: string,
    district: number,
  ): Promise<CongressMemberCandidate[]> {
    const key = `house|${state}|${district}`;
    const cached = this.deterministicMemberCache.get(key);
    if (cached) return cached;
    try {
      const res = await this.congressService.getMembersByStateAndDistrict(state, district, {
        currentMember: false,
      });
      const members = Array.isArray((res as { members?: unknown[] }).members)
        ? ((res as { members: unknown[] }).members ?? [])
        : [];
      const candidates = normalizeMemberCandidates(members, 'house');
      this.deterministicMemberCache.set(key, candidates);
      return candidates;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`resolveCandidatesByStateDistrict(${state}-${district}): ${msg}`);
      this.deterministicMemberCache.set(key, []);
      return [];
    }
  }

  private async resolveCandidatesByStateSenate(state: string): Promise<CongressMemberCandidate[]> {
    const key = `senate|${state}`;
    const cached = this.deterministicMemberCache.get(key);
    if (cached) return cached;
    try {
      const res = await this.congressService.getMembersByState(state, { currentMember: false });
      const members = Array.isArray((res as { members?: unknown[] }).members)
        ? ((res as { members: unknown[] }).members ?? [])
        : [];
      const all = normalizeMemberCandidates(members, 'senate');
      const candidates = all;
      this.deterministicMemberCache.set(key, candidates);
      return candidates;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`resolveCandidatesByStateSenate(${state}): ${msg}`);
      this.deterministicMemberCache.set(key, []);
      return [];
    }
  }

  private async deterministicPoliticianMatch(
    row: Record<string, unknown>,
    source: string,
    byBioguide: Map<string, PolMatchRow>,
  ): Promise<PolMatchRow | undefined> {
    const chamber = rowChamberHint(row, source);
    if (chamber === 'house') {
      const sd = rowStateDistrict(row);
      if (!sd) return undefined;
      const candidates = await this.resolveCandidatesByStateDistrict(sd.state, sd.district);
      const picked = pickDeterministicCandidate(row, candidates);
      if (!picked) return undefined;
      return byBioguide.get(picked.bioguideId);
    }
    if (chamber === 'senate') {
      const state = rowStateCode(row);
      if (!state || state.length !== 2) return undefined;
      const candidates = await this.resolveCandidatesByStateSenate(state);
      const picked = pickDeterministicCandidate(row, candidates);
      if (!picked) return undefined;
      return byBioguide.get(picked.bioguideId);
    }
    return undefined;
  }

  private async loadTargets(options: {
    tickers?: string[];
    limit?: number;
  }): Promise<{ rows: { ticker: string; entityId: string; securityId: string }[]; error?: string }> {
    if (!this.adminClient) return { rows: [] };
    const cap =
      options.limit != null && options.limit > 0
        ? Math.min(options.limit, MAX_TARGETS)
        : MAX_TARGETS;
    let q = this.adminClient
      .from('securities')
      .select('id, ticker, entity_id')
      .not('entity_id', 'is', null)
      .eq('active', true)
      .limit(cap);
    if (options.tickers?.length) {
      q = q.in(
        'ticker',
        options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean),
      );
    }
    const { data, error } = await q;
    if (error) {
      this.logger.error(`loadTargets: ${error.message}`);
      return { rows: [], error: `Failed to load securities: ${error.message}` };
    }
    const rows = (data ?? [])
      .filter(
        (r: { ticker?: string; entity_id?: string | null; id?: string }) =>
          r.ticker && r.entity_id && r.id,
      )
      .map((r: { ticker: string; entity_id: string; id: string }) => ({
        ticker: r.ticker.trim().toUpperCase(),
        entityId: r.entity_id,
        securityId: r.id,
      }));
    return { rows };
  }

  private async appendNoTargetsDiagnostics(
    errors: { ticker: string; message: string }[],
    options: { tickers?: string[]; limit?: number },
  ): Promise<void> {
    if (!this.adminClient) return;
    const preamble =
      'No securities matched the scoring query (requires active=true and a non-null entity_id).';
    const tickers = options.tickers?.length
      ? options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean)
      : [];
    if (!tickers.length) {
      errors.push({
        ticker: '_',
        message: `${preamble} There are no such rows in the database yet — ingest securities and assign entity_id, or widen filters.`,
      });
      return;
    }
    const { data, error } = await this.adminClient
      .from('securities')
      .select('ticker, entity_id, active')
      .in('ticker', tickers);
    if (error) {
      errors.push({
        ticker: '_',
        message: `${preamble} Could not look up tickers: ${error.message}.`,
      });
      return;
    }
    const list = (data ?? []) as {
      ticker: string;
      entity_id: string | null;
      active: boolean | null;
    }[];
    if (list.length === 0) {
      errors.push({
        ticker: '_',
        message: `${preamble} None of these tickers exist in securities: ${tickers.join(', ')}.`,
      });
      return;
    }
    const reasons = list.map((r) => {
      const sym = String(r.ticker ?? '')
        .trim()
        .toUpperCase();
      if (r.active === false) return `${sym}: inactive (active=false)`;
      if (r.entity_id == null) return `${sym}: missing entity_id`;
      return `${sym}: unexpected exclusion`;
    });
    errors.push({ ticker: '_', message: `${preamble} ${reasons.join('; ')}.` });
  }

  /**
   * Paginated FMP senate-latest + house-latest into political_trades.
   * When `backfillMissingSecurities` is true (default), each unknown ticker is
   * upserted via FMP profile once per run (same rules as `FmpService.syncTickerToSecurities`).
   */
  async syncPoliticalTradesFromFmp(options?: {
    backfillMissingSecurities?: boolean;
  }): Promise<{
    inserted: number;
    syncNotes: string[];
    errors: string[];
  }> {
    const backfillMissingSecurities = options?.backfillMissingSecurities !== false;
    const syncNotes: string[] = [];
    const errors: string[] = [];
    if (!this.adminClient) {
      return { inserted: 0, syncNotes: [], errors: ['Supabase not configured'] };
    }
    if (!this.getApiKey()) {
      return { inserted: 0, syncNotes: [], errors: ['FMP_API_KEY not configured'] };
    }
    this.deterministicMemberCache.clear();

    const { data: polRows, error: polLoadErr } = await this.adminClient
      .from('politicians')
      .select(
        'id, name_full, bioguide_id, first_name, last_name, nickname, is_current_member',
      );

    if (polLoadErr) {
      const msg = `Could not load politicians for FMP matching: ${polLoadErr.message}`;
      this.logger.error(msg);
      return { inserted: 0, syncNotes, errors: [msg] };
    }

    const polDisplayName = (p: PolMatchRow) => (p.name_full ?? '').trim();
    /** Prefer congress.gov `last_name`; else last token from `name_full` (same token FMP last-name fallback compares to). */
    function lastNameTokenForPol(p: PolMatchRow): string {
      const ln = (p.last_name ?? '').trim();
      if (ln) return ln.toLowerCase().replace(/[^a-z]/g, '');
      return lastNameTokenFromFullName(polDisplayName(p));
    }
    const byCanon = new Map<string, PolMatchRow[]>();
    const byBioguide = new Map<string, PolMatchRow>();
    const byRelaxed = new Map<string, PolMatchRow[]>();
    const byLastFirst = new Map<string, PolMatchRow[]>();
    const lastNameCounts = new Map<string, number>();
    for (const p of polRows ?? []) {
      const row = p as PolMatchRow;
      const ln = lastNameTokenForPol(row);
      if (ln) lastNameCounts.set(ln, (lastNameCounts.get(ln) ?? 0) + 1);
    }
    const byLastNameUnique = new Map<string, PolMatchRow>();
    for (const p of polRows ?? []) {
      const row = p as PolMatchRow;
      const ln = lastNameTokenForPol(row);
      if (ln && lastNameCounts.get(ln) === 1) byLastNameUnique.set(ln, row);
    }
    for (const p of polRows ?? []) {
      const row = p as PolMatchRow;
      registerPoliticianMatchKeys(row, byCanon, byRelaxed, byLastFirst);
      if (row.bioguide_id) {
        const bg = String(row.bioguide_id).trim().toUpperCase();
        if (bg) byBioguide.set(bg, row);
      }
    }

    if ((polRows ?? []).length === 0) {
      syncNotes.push(
        'No politicians in database — run member sync (scripts/sync-members.js or Congress sync) so FMP disclosures can match filers.',
      );
    }

    const secByTicker = await this.loadActiveSecuritiesTickerMap();
    const backfillAttempted = new Set<string>();
    let backfillSucceeded = 0;

    let inserted = 0;
    const batch: Record<string, unknown>[] = [];
    let skipNoSecurity = 0;
    let skipNoPolitician = 0;
    let skipNoName = 0;
    let skipInvalidDate = 0;
    let skipInvalidSide = 0;
    const matchMethodCounts = new Map<MatchMethod, number>();
    const skipSymbolCounts = new Map<string, number>();
    const filerUnmatchedCounts = new Map<string, number>();
    const rawTxTypeUnrecognized = new Map<string, number>();
    const skipInvalidDateRaw = new Map<string, number>();

    const ingestEndpoint = async (basePath: string, source: string) => {
      for (let page = 0; page < MAX_SYNC_PAGES; page++) {
        const path = `${basePath}?page=${page}&limit=${SYNC_PAGE_LIMIT}`;
        const data = fmpParseArray(await this.fmpGetRaw(path));
        if (!data || data.length === 0) break;

        for (const row of data) {
          const symRaw = str(row.symbol ?? row.ticker);
          if (!symRaw) continue;
          let securityId = resolveSecurityId(secByTicker, symRaw);
          if (!securityId && backfillMissingSecurities) {
            const symKey = symRaw.trim().toUpperCase();
            if (!backfillAttempted.has(symKey)) {
              backfillAttempted.add(symKey);
              const bf = await this.fmpService.syncTickerToSecurities(symRaw.trim());
              if (bf.ok) {
                secByTicker.set(symKey, bf.security_id);
                backfillSucceeded++;
                securityId = bf.security_id;
              }
            } else {
              securityId = resolveSecurityId(secByTicker, symRaw);
            }
          }
          if (!securityId) {
            skipNoSecurity++;
            const symKey = symRaw.trim().toUpperCase();
            skipSymbolCounts.set(symKey, (skipSymbolCounts.get(symKey) ?? 0) + 1);
            continue;
          }
          const sym = symRaw.trim().toUpperCase();

          const matchCtx = {
            byBioguide,
            byCanon,
            byRelaxed,
            byLastFirst,
            byLastNameUnique,
          };
          let pol: PolMatchRow | undefined;
          let matchMethod: MatchMethod | null = null;

          const bg = fmpBioguideFromRow(row);
          if (bg && byBioguide.has(bg)) {
            pol = byBioguide.get(bg);
            matchMethod = 'direct_bioguide';
          }
          if (!pol) {
            pol = await this.deterministicPoliticianMatch(row, source, byBioguide);
            if (pol) {
              matchMethod = rowChamberHint(row, source) === 'house'
                ? 'deterministic_house'
                : 'deterministic_senate';
            }
          }
          if (!pol) {
            pol = matchFmpRowToPolitician(row, matchCtx);
            if (pol) matchMethod = 'name_fallback';
          }
          if (!pol) {
            const hasAnyId =
              Boolean(fmpBioguideFromRow(row)) ||
              Boolean(str(row.firstName ?? row.first_name)) ||
              Boolean(str(row.lastName ?? row.last_name)) ||
              fmpNameCandidates(row).length > 0;
            if (!hasAnyId) {
              skipNoName++;
            } else {
              skipNoPolitician++;
              const lab = filerSkipLabel(row);
              filerUnmatchedCounts.set(lab, (filerUnmatchedCounts.get(lab) ?? 0) + 1);
            }
            continue;
          }
          if (matchMethod) {
            matchMethodCounts.set(matchMethod, (matchMethodCounts.get(matchMethod) ?? 0) + 1);
          }

          const td = parseFmpTransactionDate(row);
          if (!td) {
            skipInvalidDate++;
            const rawD = str(
              row.transactionDate ??
                row.date ??
                row.transactionDateFormatted ??
                row.transaction_date ??
                '',
            );
            const dk = rawD || '(empty)';
            skipInvalidDateRaw.set(dk, (skipInvalidDateRaw.get(dk) ?? 0) + 1);
            continue;
          }

          const disclosureDate = parseFmpTransactionDate({
            transactionDate: row.disclosureDate ?? row.disclosureDateFormatted,
            date: row.disclosureDate ?? row.disclosureDateFormatted,
          });

          const rawTxType = str(row.type ?? row.transactionType ?? row.side);
          const side = parseTradeSide(rawTxType);
          if (!side) {
            skipInvalidSide++;
            const tk = rawTxType || '(empty)';
            rawTxTypeUnrecognized.set(tk, (rawTxTypeUnrecognized.get(tk) ?? 0) + 1);
            continue;
          }

          const { mid, low, high } = parseUsdMidpoint(
            row.amount ?? row.amounts ?? row.range ?? row.assetAmount,
          );

          const ext = hashExternalId([
            source,
            td,
            sym,
            pol.id,
            side,
            str(row.type),
            str(row.amount ?? row.amounts),
          ]);

          batch.push({
            politician_id: pol.id,
            security_id: securityId,
            trade_date: td,
            disclosure_date: disclosureDate,
            side,
            value_usd: mid,
            value_usd_low: low,
            value_usd_high: high,
            source,
            external_id: ext,
            raw: row,
            updated_at: new Date().toISOString(),
          });
        }

        if (data.length < SYNC_PAGE_LIMIT) break;
        await new Promise((r) => setTimeout(r, 150));
      }
    };

    await ingestEndpoint('/stable/senate-latest', 'fmp_senate');
    await ingestEndpoint('/stable/house-latest', 'fmp_house');

    if (backfillMissingSecurities && backfillSucceeded > 0) {
      syncNotes.push(
        `${backfillSucceeded} ticker(s) added/updated in securities via FMP profile (on-demand backfill).`,
      );
    }
    if (skipNoSecurity > 0) {
      syncNotes.push(
        `${skipNoSecurity} FMP disclosure rows skipped — symbol not in your securities table (normal for tickers outside your universe).`,
      );
      const symDetail = formatTopCountMap(
        skipSymbolCounts,
        FMP_SYNC_DETAIL_TOP_SYMBOLS,
        'symbols',
      );
      if (symDetail) {
        syncNotes.push(`Details — skipped symbols: ${symDetail}`);
      }
    }
    if (skipNoPolitician > 0) {
      syncNotes.push(
        `${skipNoPolitician} FMP rows skipped — filer not matched to politicians (name/bioguide; spouse or dependent rows often differ from member names in DB).`,
      );
      const filerDetail = formatTopCountMap(
        filerUnmatchedCounts,
        FMP_SYNC_DETAIL_MAX_FILER_LABELS,
        'filer labels',
      );
      if (filerDetail) {
        syncNotes.push(`Details — unmatched filers (sample): ${filerDetail}`);
      }
    }
    if (skipNoName > 0) {
      syncNotes.push(
        `${skipNoName} FMP rows skipped — missing filer name in payload.`,
      );
    }
    if (skipInvalidDate > 0) {
      syncNotes.push(
        `${skipInvalidDate} rows skipped — transaction date could not be parsed (check FMP field formats).`,
      );
      const dateDetail = formatTopCountMap(
        skipInvalidDateRaw,
        FMP_SYNC_DETAIL_MAX_RAW_TYPES,
        'raw date values',
      );
      if (dateDetail) {
        syncNotes.push(`Details — unparseable transaction dates: ${dateDetail}`);
      }
    }
    if (skipInvalidSide > 0) {
      syncNotes.push(
        `${skipInvalidSide} rows skipped — transaction type not recognized as buy/sell.`,
      );
      const typeDetail = formatTopCountMap(
        rawTxTypeUnrecognized,
        FMP_SYNC_DETAIL_MAX_RAW_TYPES,
        'type strings',
      );
      if (typeDetail) {
        syncNotes.push(`Details — unrecognized transaction types: ${typeDetail}`);
      }
    }
    if (matchMethodCounts.size > 0) {
      const parts = [...matchMethodCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}=${n}`);
      syncNotes.push(`Match methods used: ${parts.join(', ')}`);
    }

    /** One row per external_id — required: Postgres rejects ON CONFLICT if the same key appears twice in one INSERT. */
    const externalIdOccurrences = new Map<string, number>();
    const byExternalId = new Map<string, Record<string, unknown>>();
    for (const row of batch) {
      const id = String(row.external_id ?? '');
      if (!id) continue;
      externalIdOccurrences.set(id, (externalIdOccurrences.get(id) ?? 0) + 1);
      byExternalId.set(id, row);
    }
    const uniqueBatch = [...byExternalId.values()];
    const droppedDupes = batch.length - uniqueBatch.length;
    if (droppedDupes > 0) {
      syncNotes.push(
        `${droppedDupes} duplicate external_id rows collapsed before upsert (same disclosure key from FMP or overlapping feeds).`,
      );
      const dupKeys = [...externalIdOccurrences.entries()]
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, FMP_SYNC_DETAIL_MAX_DUP_KEYS);
      if (dupKeys.length > 0) {
        const parts = dupKeys.map(([id, n]) => `${id.slice(0, 16)}…×${n}`);
        syncNotes.push(
          `Details — duplicate external_id keys (sample, count = rows sharing that hash): ${parts.join('; ')}`,
        );
      }
    }

    const CHUNK = 80;
    for (let i = 0; i < uniqueBatch.length; i += CHUNK) {
      const chunk = uniqueBatch.slice(i, i + CHUNK);
      const { error } = await this.adminClient
        .from('political_trades')
        .upsert(chunk, { onConflict: 'external_id' });
      if (error) {
        this.logger.error(`political_trades upsert: ${error.message}`);
        errors.push(error.message);
      } else {
        inserted += chunk.length;
      }
    }

    return { inserted, syncNotes, errors };
  }

  private async loadSectorLabel(securityId: string): Promise<string> {
    if (!this.adminClient) return '';
    const { data: sc } = await this.adminClient
      .from('security_classifications')
      .select('taxonomy_node_id')
      .eq('security_id', securityId)
      .order('as_of_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nodeId = (sc as { taxonomy_node_id?: string } | null)?.taxonomy_node_id;
    if (!nodeId) return '';
    const { data: node } = await this.adminClient
      .from('taxonomy_nodes')
      .select('title, name')
      .eq('node_id', nodeId)
      .maybeSingle();
    const n = node as { title?: string; name?: string } | null;
    return (n?.title ?? n?.name ?? '').trim();
  }

  private async loadCommitteeContext(
    bioguideId: string | null,
    tradeIsoDate: string,
  ): Promise<{ names: string[]; roles: CommitteeRole[] }> {
    if (!this.adminClient || !bioguideId) return { names: [], roles: [] };
    const congress = congressNumberForTradeDate(tradeIsoDate);
    const { data: pcm } = await this.adminClient
      .from('politician_committee_memberships')
      .select('role, committee_system_code')
      .eq('bioguide_id', bioguideId)
      .eq('congress', congress);

    const roles: CommitteeRole[] = [];
    const codes = new Set<string>();
    for (const row of pcm ?? []) {
      const r = row as { role: CommitteeRole; committee_system_code: string };
      roles.push(r.role);
      codes.add(r.committee_system_code);
    }
    if (codes.size === 0) return { names: [], roles };

    const { data: comms } = await this.adminClient
      .from('committees')
      .select('system_code, name')
      .in('system_code', [...codes]);

    const names = (comms ?? [])
      .map((c) => (c as { name?: string }).name)
      .filter((n): n is string => Boolean(n && String(n).trim()));
    return { names, roles };
  }

  private clusterCountForTrade(
    sorted: PoliticalTradeRow[],
    index: number,
  ): number {
    const t = sorted[index]!;
    const tDate = t.trade_date;
    const start = new Date(`${tDate}T12:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - 90);
    const startStr = start.toISOString().slice(0, 10);
    const pols = new Set<string>();
    for (let j = 0; j <= index; j++) {
      const u = sorted[j]!;
      if (u.side !== t.side) continue;
      if (u.trade_date < startStr || u.trade_date > tDate) continue;
      pols.add(u.politician_id);
    }
    return pols.size;
  }

  async calculateScores(options: {
    tickers?: string[];
    limit?: number;
    minScore?: number;
    maxScore?: number;
  }): Promise<PoliticalScoreCalculateResult> {
    const empty: PoliticalScoreCalculateResult = {
      tickersRequested: 0,
      tickersWithData: 0,
      scoresWritten: 0,
      tradesSynced: 0,
      syncNotes: [],
      errors: [],
      scores: [],
      tradesUsedInScoring: 0,
    };
    if (!this.adminClient) {
      empty.errors.push({ ticker: '_', message: 'Supabase not configured' });
      return empty;
    }

    const sync = await this.syncPoliticalTradesFromFmp();
    empty.tradesSynced = sync.inserted;
    for (const m of sync.syncNotes) {
      empty.syncNotes.push({ ticker: '_', message: m });
    }
    for (const m of sync.errors.slice(0, 20)) {
      empty.errors.push({ ticker: '_', message: m });
    }

    const { rows: targets, error: loadErr } = await this.loadTargets(options);
    if (loadErr) {
      empty.errors.push({ ticker: '_', message: loadErr });
      return empty;
    }
    empty.tickersRequested = targets.length;
    if (targets.length === 0) {
      await this.appendNoTargetsDiagnostics(empty.errors, options);
      return empty;
    }

    const { data: formulaRow } = await this.adminClient
      .from('formulas')
      .select('id, definition')
      .eq('key', 'political_score')
      .maybeSingle();
    if (!formulaRow?.id) {
      empty.errors.push({
        ticker: '_',
        message:
          'Formula political_score not found; run migration 20260402110000_seed_political_score_formula.sql',
      });
      return empty;
    }
    const tradeWeights = this.politicalTradeWeightsFromDefinition(formulaRow.definition);

    const { data: factorRows } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', [...PS_FACTOR_KEYS]);
    const factorIdByKey: Record<string, string> = Object.fromEntries(
      (factorRows ?? []).map((f: { id: string; key: string }) => [f.key, f.id]),
    );
    for (const k of PS_FACTOR_KEYS) {
      if (!factorIdByKey[k]) {
        empty.errors.push({
          ticker: '_',
          message: `Factor ${k} not found; run migration 20260402110000_seed_political_score_formula.sql`,
        });
        return empty;
      }
    }

    const asOf = new Date();
    const windowStart = new Date(asOf);
    windowStart.setUTCDate(windowStart.getUTCDate() - POLITICAL_WINDOW_DAYS);
    const windowStartStr = windowStart.toISOString().slice(0, 10);

    const fetchStart = new Date(asOf);
    fetchStart.setUTCDate(
      fetchStart.getUTCDate() - (POLITICAL_WINDOW_DAYS + TRADE_FETCH_EXTRA_DAYS),
    );
    const fetchStartStr = fetchStart.toISOString().slice(0, 10);

    const securityIds = [...new Set(targets.map((t) => t.securityId))];
    const { data: tradeData } = await this.adminClient
      .from('political_trades')
      .select('id, politician_id, security_id, trade_date, side, value_usd')
      .in('security_id', securityIds)
      .gte('trade_date', fetchStartStr)
      .order('trade_date', { ascending: true });

    const tradesBySecurity = new Map<string, PoliticalTradeRow[]>();
    for (const tr of tradeData ?? []) {
      const r = tr as PoliticalTradeRow;
      const list = tradesBySecurity.get(r.security_id) ?? [];
      list.push(r);
      tradesBySecurity.set(r.security_id, list);
    }

    const polIds = [
      ...new Set((tradeData ?? []).map((t) => (t as PoliticalTradeRow).politician_id)),
    ];
    const bioguideByPolId = new Map<string, string | null>();
    if (polIds.length > 0) {
      const { data: polMeta } = await this.adminClient
        .from('politicians')
        .select('id, bioguide_id')
        .in('id', polIds);
      for (const p of polMeta ?? []) {
        const row = p as { id: string; bioguide_id: string | null };
        bioguideByPolId.set(row.id, row.bioguide_id);
      }
    }

    const results: {
      ticker: string;
      entityId: string;
      securityId: string;
      score: number;
      buyPressure: number;
      sellPressure: number;
      tradesUsed: number;
      factorAvg: {
        committee: number;
        tradeSize: number;
        recency: number;
        influence: number;
        cluster: number;
      };
    }[] = [];

    let tradesUsedTotal = 0;

    for (const tgt of targets) {
      const list = tradesBySecurity.get(tgt.securityId) ?? [];
      const sector = await this.loadSectorLabel(tgt.securityId);
      const sectorText = `${sector} general`.toLowerCase();

      let buyP = 0;
      let sellP = 0;
      let sumRel = 0;
      let sumSz = 0;
      let sumRec = 0;
      let sumInfl = 0;
      let sumCl = 0;
      let tradeCount = 0;

      const sorted = [...list].sort((a, b) => a.trade_date.localeCompare(b.trade_date));

      for (let i = 0; i < sorted.length; i++) {
        const tr = sorted[i]!;
        if (tr.trade_date < windowStartStr) continue;
        if (recencyScore(tr.trade_date, asOf) <= 0) continue;

        const bg = bioguideByPolId.get(tr.politician_id) ?? null;
        const ctx = await this.loadCommitteeContext(bg, tr.trade_date);
        const rel = committeeRelevanceForTrade(sectorText, ctx.names);
        const infl = maxInfluenceScore(ctx.roles);

        const sz = tradeSizeScore(tr.value_usd != null ? Number(tr.value_usd) : null);
        const rec = recencyScore(tr.trade_date, asOf);
        const cl = clusterScore(this.clusterCountForTrade(sorted, i));

        const ts = tradeScoreFromFactors(rel, sz, rec, infl, cl, tradeWeights);
        sumRel += rel;
        sumSz += sz;
        sumRec += rec;
        sumInfl += infl;
        sumCl += cl;
        tradeCount++;
        if (tr.side === 'buy') buyP += ts;
        else sellP += ts;
      }

      tradesUsedTotal += tradeCount;

      const n = Math.max(1, tradeCount);
      const score = politicalScoreFromPressures(buyP, sellP);
      results.push({
        ticker: tgt.ticker,
        entityId: tgt.entityId,
        securityId: tgt.securityId,
        score,
        buyPressure: buyP,
        sellPressure: sellP,
        tradesUsed: tradeCount,
        factorAvg: {
          committee: tradeCount ? sumRel / n : 0,
          tradeSize: tradeCount ? sumSz / n : 0,
          recency: tradeCount ? sumRec / n : 0,
          influence: tradeCount ? sumInfl / n : 0,
          cluster: tradeCount ? sumCl / n : 0,
        },
      });
    }

    empty.tickersWithData = results.length;

    const ranked = [...results].sort((a, b) => b.score - a.score);
    const globalRank = new Map<string, number>();
    ranked.forEach((f, idx) => globalRank.set(f.entityId, idx + 1));

    let filtered = results;
    const minS = options.minScore;
    const maxS = options.maxScore;
    if (minS != null && Number.isFinite(minS)) {
      filtered = filtered.filter((r) => r.score >= minS!);
    }
    if (maxS != null && Number.isFinite(maxS)) {
      filtered = filtered.filter((r) => r.score <= maxS!);
    }

    const filteredRanked = [...filtered].sort((a, b) => b.score - a.score);
    const responseRankByEntity = new Map<string, number>();
    filteredRanked.forEach((f, idx) => responseRankByEntity.set(f.entityId, idx + 1));

    const now = new Date().toISOString();
    const scoreRows: {
      entity_id: string;
      formula_id: string;
      score: number;
      rank: number | null;
      explanation: Record<string, unknown>;
      updated_at: string;
    }[] = [];

    for (const r of results) {
      const rank = globalRank.get(r.entityId) ?? null;
      scoreRows.push({
        entity_id: r.entityId,
        formula_id: formulaRow.id,
        score: r.score,
        rank,
        explanation: {
          asOf: now,
          windowDays: POLITICAL_WINDOW_DAYS,
          responseRank: responseRankByEntity.get(r.entityId) ?? null,
          buyPressure: r.buyPressure,
          sellPressure: r.sellPressure,
          tradesUsed: r.tradesUsed,
          factorAverages: r.factorAvg,
        },
        updated_at: now,
      });
    }

    const efvRows: Record<string, unknown>[] = [];
    for (const r of results) {
      if (r.tradesUsed === 0) continue;
      const fa = r.factorAvg;
      const pairs: [string, number][] = [
        ['ps_committee_relevance_pct', fa.committee],
        ['ps_trade_size_pct', fa.tradeSize],
        ['ps_recency_pct', fa.recency],
        ['ps_influence_pct', fa.influence],
        ['ps_cluster_pct', fa.cluster],
      ];
      for (const [key, val] of pairs) {
        efvRows.push({
          entity_id: r.entityId,
          factor_id: factorIdByKey[key]!,
          model_version: PS_MODEL_VERSION,
          period_key: PS_PERIOD_KEY,
          value_num: val,
          source: 'political_score_engine',
          ingested_at: now,
        });
      }
    }

    const BATCH = 75;
    for (let i = 0; i < efvRows.length; i += BATCH) {
      const chunk = efvRows.slice(i, i + BATCH);
      const { error: efvErr } = await this.adminClient
        .from('entity_factor_values')
        .upsert(chunk, {
          onConflict: 'entity_id,factor_id,model_version,period_key',
        });
      if (efvErr) {
        this.logger.error(`entity_factor_values upsert: ${efvErr.message}`);
        throw new Error(efvErr.message);
      }
    }

    for (let i = 0; i < scoreRows.length; i += BATCH) {
      const chunk = scoreRows.slice(i, i + BATCH);
      const { error: scErr } = await this.adminClient
        .from('entity_scores_current')
        .upsert(
          chunk.map((c) => ({
            entity_id: c.entity_id,
            formula_id: c.formula_id,
            score: c.score,
            rank: c.rank,
            explanation: c.explanation,
            updated_at: c.updated_at,
          })),
          { onConflict: 'entity_id,formula_id' },
        );
      if (scErr) {
        this.logger.error(`entity_scores_current upsert: ${scErr.message}`);
        throw new Error(scErr.message);
      }
    }

    const hist = scoreRows.map((row) => ({
      entity_id: row.entity_id,
      formula_id: row.formula_id,
      score: row.score,
    }));
    for (let i = 0; i < hist.length; i += BATCH) {
      await this.adminClient.from('entity_scores_history').insert(hist.slice(i, i + BATCH));
    }

    empty.scoresWritten = scoreRows.length;
    empty.tradesUsedInScoring = tradesUsedTotal;
    empty.scores = filtered.map((f) => ({
      ticker: f.ticker,
      security_id: f.securityId,
      score: Math.round(f.score * 1000) / 1000,
      rank: responseRankByEntity.get(f.entityId) ?? null,
      buyPressure: f.buyPressure,
      sellPressure: f.sellPressure,
      tradesUsed: f.tradesUsed,
    }));

    if (tradesUsedTotal === 0 && targets.length > 0) {
      empty.syncNotes.push({
        ticker: '_',
        message:
          'No congressional trades in the scoring window matched your target securities after sync. Scores stay at 0 until political_trades contains rows for those symbols (Formulas.md buy/sell pressure).',
      });
    }

    return empty;
  }

  /** Return persisted scores without triggering a recalculation. */
  async loadCurrentScores(options: {
    tickers?: string[];
    limit?: number;
    minScore?: number;
    maxScore?: number;
  }): Promise<PoliticalScoreCalculateResult> {
    const empty: PoliticalScoreCalculateResult = {
      tickersRequested: 0,
      tickersWithData: 0,
      scoresWritten: 0,
      tradesSynced: 0,
      syncNotes: [],
      errors: [],
      scores: [],
      tradesUsedInScoring: 0,
    };
    if (!this.adminClient) {
      empty.errors.push({ ticker: '_', message: 'Supabase not configured' });
      return empty;
    }

    const { data: formulaRow } = await this.adminClient
      .from('formulas')
      .select('id')
      .eq('key', 'political_score')
      .maybeSingle();
    if (!formulaRow?.id) {
      empty.errors.push({ ticker: '_', message: 'Formula political_score not found' });
      return empty;
    }

    let secQ = this.adminClient
      .from('securities')
      .select('id, ticker, entity_id')
      .not('entity_id', 'is', null)
      .eq('active', true);
    if (options.tickers?.length) {
      secQ = secQ.in('ticker', options.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
    }
    if (options.limit != null && options.limit > 0) secQ = secQ.limit(options.limit);
    const { data: secData } = await secQ;
    const secByEntity = new Map<string, { ticker: string; securityId: string }>(
      ((secData ?? []) as { id: string; ticker: string; entity_id: string }[]).map((r) => [
        r.entity_id,
        { ticker: r.ticker, securityId: r.id },
      ]),
    );
    const entityIds = [...secByEntity.keys()];
    empty.tickersRequested = entityIds.length;
    if (entityIds.length === 0) return empty;

    let csQ = this.adminClient
      .from('entity_scores_current')
      .select('entity_id, score, rank, explanation')
      .eq('formula_id', formulaRow.id as string)
      .in('entity_id', entityIds);
    if (options.minScore != null && Number.isFinite(options.minScore)) {
      csQ = csQ.gte('score', options.minScore);
    }
    if (options.maxScore != null && Number.isFinite(options.maxScore)) {
      csQ = csQ.lte('score', options.maxScore);
    }
    csQ = csQ.order('score', { ascending: false });

    const { data: csData, error: csErr } = await csQ;
    if (csErr) {
      empty.errors.push({ ticker: '_', message: `Failed to load current scores: ${csErr.message}` });
      return empty;
    }

    let tradesUsedTotal = 0;
    const rows = ((csData ?? []) as {
      entity_id: string;
      score: number;
      rank: number | null;
      explanation: Record<string, unknown> | null;
    }[])
      .filter((r) => secByEntity.has(r.entity_id))
      .map((r, i) => {
        const ex = r.explanation ?? {};
        const tradesUsed = typeof ex.tradesUsed === 'number' ? ex.tradesUsed : 0;
        tradesUsedTotal += tradesUsed;
        const sec = secByEntity.get(r.entity_id);
        return {
          ticker: sec?.ticker ?? '',
          security_id: sec?.securityId ?? '',
          score: r.score,
          rank: r.rank ?? i + 1,
          buyPressure: typeof ex.buyPressure === 'number' ? ex.buyPressure : 0,
          sellPressure: typeof ex.sellPressure === 'number' ? ex.sellPressure : 0,
          tradesUsed,
        };
      });

    empty.tickersWithData = rows.length;
    empty.scores = rows;
    empty.tradesUsedInScoring = tradesUsedTotal;
    return empty;
  }
}
