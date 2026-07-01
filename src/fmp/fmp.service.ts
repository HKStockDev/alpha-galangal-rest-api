import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  buildIngestSnapshotFromProfile,
  evaluateIngestAgainstFilters,
  ingestSecurityTypeToTypeCode,
  type IngestEvaluationSnapshot,
} from '../stock-ingest-filters/ingest-filter-evaluator';
import { StockIngestFiltersService } from '../stock-ingest-filters/stock-ingest-filters.service';
import type { FmpProfileDto } from './dto/fmp-profile.dto';
import type {
  FmpSyncPoliticalFeedMissingSecuritiesResult,
  FmpSyncTickerResult,
} from './fmp-sync-result';

export type FmpStockChartRange =
  | '1D'
  | '5D'
  | '1M'
  | '3M'
  | '6M'
  | 'YTD'
  | '1Y'
  | '5Y'
  | 'MAX';

export interface FmpStockChartPoint {
  ts: string;
  /** null for 1d (daily-line) bars — only close is available from FMP serietype=line */
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

/** DB intervals.  5min→1D chart, 15min→5D chart, 1d→1M…MAX chart */
export type SecurityPriceBarInterval = '5min' | '15min' | '1d';

export interface IngestStockChartBarsResult {
  security_id: string;
  ticker: string;
  /** Which chart range was synced (determines FMP path + DB interval). */
  chart_range: FmpStockChartRange;
  intervals: Partial<Record<SecurityPriceBarInterval, number>>;
  errors: string[];
}

/** Normalized row from FMP v3 `stock_news`. */
export interface FmpStockNewsArticleDto {
  published_at: string | null;
  title: string;
  summary: string | null;
  url: string | null;
  source: string | null;
  symbols: string[];
}

/** Normalized row from FMP v3 `press-releases/{symbol}`. */
export interface FmpPressReleaseDto {
  published_at: string | null;
  title: string;
  text: string | null;
  url: string | null;
}

export interface FmpStockNewsBundleDto {
  ticker: string;
  stock_news: FmpStockNewsArticleDto[];
  press_releases: FmpPressReleaseDto[];
  warnings: string[];
}

export interface IngestSecurityFmpNewsResult {
  security_id: string;
  ticker: string;
  upserted: number;
  stock_news_rows: number;
  press_release_rows: number;
  warnings: string[];
}

type FmpRawPriceRow = {
  date?: string;
  open?: number | string | null;
  high?: number | string | null;
  low?: number | string | null;
  close?: number | string | null;
  /** Stable EOD “light” rows sometimes expose only adjusted close */
  adjClose?: number | string | null;
  /** Stable `historical-price-eod/light` uses `price` (not `close`) for the daily value */
  price?: number | string | null;
  volume?: number | string | null;
};

/** Internal representation after parsing FMP rows (before writing ISO strings). */
type MillisBarPoint = {
  ts: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

@Injectable()
export class FmpService {
  private readonly logger = new Logger(FmpService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(
    private config: ConfigService,
    private readonly stockIngestFiltersService: StockIngestFiltersService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
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
    );
  }

  private mapProfileToSecuritiesRow(
    r: FmpProfileDto,
    snap: IngestEvaluationSnapshot,
  ): Record<string, unknown> {
    const listDate = r.ipoDate ?? null;
    const employees =
      r.fullTimeEmployees != null
        ? r.fullTimeEmployees
        : (r.employees != null ? r.employees : null);
    const exchange = r.exchangeShortName ?? r.exchange ?? null;
    return {
      ticker: (r.symbol ?? '').trim() || '',
      market: 'stocks',
      locale: 'us',
      name: (r.companyName ?? r.symbol ?? '').trim() || (r.symbol ?? ''),
      ticker_root: null,
      ticker_suffix: null,
      cik: r.cik ?? null,
      composite_figi: null,
      share_class_figi: null,
      type_code: ingestSecurityTypeToTypeCode(snap.securityType),
      type_description: snap.securityType,
      description: r.description ?? null,
      homepage_url: r.website ?? null,
      phone_number: r.phone ?? null,
      total_employees: employees != null ? Number(employees) : null,
      list_date:
        listDate && /^\d{4}-\d{2}-\d{2}$/.test(String(listDate).slice(0, 10))
          ? String(listDate).slice(0, 10)
          : null,
      primary_exchange: exchange,
      currency_name: r.currency ?? null,
      sic_code: null,
      sic_description: null,
      market_cap: r.marketCap ?? null,
      country: snap.canonicalCountry,
      avg_volume: snap.avgShareVolume,
      last_price: snap.priceUsd,
      avg_dollar_volume: snap.avgDollarVolumeUsd,
      share_class_shares_outstanding: null,
      weighted_shares_outstanding: null,
      round_lot: null,
      active: true,
      delisted_utc: null,
      updated_at: new Date().toISOString(),
    };
  }

  async fetchProfileFromApi(symbol: string): Promise<FmpProfileDto | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('FMP_API_KEY not configured');
      return null;
    }
    const baseUrl = this.getBaseUrl().replace(/\/$/, '');
    const url = `${baseUrl}/stable/profile?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = (await res.json()) as FmpProfileDto[];
    if (!res.ok) {
      this.logger.warn(
        `FMP API error ${res.status}: ${(data as { 'Error Message'?: string })['Error Message'] ?? res.statusText}`,
      );
      return null;
    }
    if (!Array.isArray(data) || data.length === 0) {
      this.logger.warn(`No profile for symbol=${symbol}`);
      return null;
    }
    return data[0];
  }

  async fetchStockChart(
    symbol: string,
    range: FmpStockChartRange,
  ): Promise<{ symbol: string; range: FmpStockChartRange; points: FmpStockChartPoint[] }> {
    const normalized = symbol.trim().toUpperCase();
    if (this.adminClient) {
      const sid = await this.lookupSecurityIdByTicker(normalized);
      if (sid) {
        const fromDb = await this.tryLoadStockChartFromDatabase(sid, range);
        if (fromDb.length > 0) {
          return { symbol: normalized, range, points: fromDb };
        }
      }
    }
    return this.fetchStockChartLiveFromFmp(normalized, range);
  }

  /**
   * FMP v3 stock headlines (`/api/v3/stock_news`) and company press releases (`/api/v3/press-releases/{symbol}`).
   * Not persisted — for admin / tooling views.
   */
  async fetchStockNewsBundle(
    tickerRaw: string,
    options?: { stockNewsLimit?: number; pressReleasesLimit?: number },
  ): Promise<FmpStockNewsBundleDto> {
    const ticker = tickerRaw.trim().toUpperCase();
    if (!ticker) {
      throw new BadRequestException('ticker is required');
    }
    if (!this.getApiKey()) {
      throw new BadRequestException('FMP_API_KEY not configured');
    }
    const stockLimit = Math.min(100, Math.max(1, options?.stockNewsLimit ?? 10));
    const pressLimit = Math.min(100, Math.max(1, options?.pressReleasesLimit ?? 10));
    const warnings: string[] = [];

    const stockPath = `/api/v3/stock_news?tickers=${encodeURIComponent(ticker)}&limit=${stockLimit}`;
    let pressSymbol = ticker;
    let pressPath = `/api/v3/press-releases/${encodeURIComponent(pressSymbol)}?limit=${pressLimit}`;

    const [rawNews, rawPressFirst] = await Promise.all([
      this.fmpGetRawForPath(stockPath, { passThroughErrorObject: true }),
      this.fmpGetRawForPath(pressPath, { passThroughErrorObject: true }),
    ]);

    let rawPress: unknown = rawPressFirst;
    if (this.isFmpErrorPayload(rawPress) && ticker.includes('.')) {
      pressSymbol = ticker.replace(/\./g, '-');
      pressPath = `/api/v3/press-releases/${encodeURIComponent(pressSymbol)}?limit=${pressLimit}`;
      rawPress = await this.fmpGetRawForPath(pressPath, { passThroughErrorObject: true });
      if (!this.isFmpErrorPayload(rawPress)) {
        warnings.push(`press_releases: retried with symbol ${pressSymbol} (FMP path prefers dash form).`);
      }
    }

    let stock_news = this.parseFmpStockNewsRows(rawNews, warnings, 'stock_news');
    if (stock_news.length === 0) {
      const stableStockPath = `/stable/news/stock?symbols=${encodeURIComponent(ticker)}&limit=${stockLimit}`;
      const rawStableStock = await this.fmpGetRawForPath(stableStockPath, {
        passThroughErrorObject: true,
      });
      stock_news = this.parseFmpStockNewsRows(rawStableStock, warnings, 'stock_news_stable');
      if (stock_news.length > 0) {
        warnings.push(
          'stock_news: used FMP stable /stable/news/stock (v3 /api/v3/stock_news had no usable rows).',
        );
      }
    }

    let press_releases = this.parseFmpPressReleaseRows(rawPress, warnings, 'press_releases');
    if (press_releases.length === 0) {
      const symCandidates = Array.from(
        new Set(
          [pressSymbol, ticker, ticker.includes('.') ? ticker.replace(/\./g, '-') : null].filter(
            (x): x is string => !!x?.trim(),
          ),
        ),
      );
      for (const sym of symCandidates) {
        const stablePrPath = `/stable/news/press-releases?symbols=${encodeURIComponent(sym)}&limit=${pressLimit}`;
        const rawStablePr = await this.fmpGetRawForPath(stablePrPath, {
          passThroughErrorObject: true,
        });
        press_releases = this.parseFmpPressReleaseRows(rawStablePr, warnings, 'press_releases_stable');
        if (press_releases.length > 0) {
          warnings.push(
            `press_releases: used FMP stable /stable/news/press-releases (symbol=${sym}; v3 had no usable rows).`,
          );
          break;
        }
      }
    }

    if (stock_news.length === 0 && press_releases.length === 0) {
      warnings.push(
        'FMP returned no stock news and no press releases for this ticker after v3 and stable fallbacks. ' +
          'Verify FMP_API_KEY on the API server, your FMP plan limits, and the security ticker. ' +
          'You can sanity-check with GET /fmp/stocks/AAPL/news (replace AAPL).',
      );
    }

    return { ticker, stock_news, press_releases, warnings };
  }

  private parseFmpStockNewsRows(
    raw: unknown,
    warnings: string[],
    label: string,
  ): FmpStockNewsArticleDto[] {
    if (raw != null && typeof raw === 'object' && !Array.isArray(raw) && this.isFmpErrorPayload(raw)) {
      warnings.push(`${label}: ${this.fmpErrorMessage(raw) ?? 'FMP Error Message'}`);
      return [];
    }
    const rows = this.fmpExtractNewsArrayRecords(raw);
    if (!rows) {
      if (raw != null && !this.isFmpErrorPayload(raw)) {
        warnings.push(`${label}: unexpected JSON (expected an array or known wrapper)`);
      }
      return [];
    }
    const out: FmpStockNewsArticleDto[] = [];
    for (const row of rows) {
      const sym = this.str(row.symbol ?? row.ticker ?? row.stock);
      const symbols: string[] = [];
      if (sym) symbols.push(sym);
      const tickersField = row.tickers ?? row.symbols;
      if (Array.isArray(tickersField)) {
        for (const t of tickersField) {
          const s = this.str(t);
          if (s && !symbols.includes(s)) symbols.push(s);
        }
      }
      const published =
        this.str(
          row.publishedDate ??
            row.published_date ??
            row.date ??
            row.pubDate ??
            row.publishedTime,
        ) || null;
      const title = this.str(row.title ?? row.headline ?? row.name);
      if (!title) continue;
      const summaryRaw = this.str(
        row.text ?? row.description ?? row.summary ?? row.snippet ?? row.content,
      );
      out.push({
        published_at: published,
        title,
        summary: summaryRaw || null,
        url: this.str(row.url ?? row.link ?? row.article_url) || null,
        source: this.str(row.site ?? row.source ?? row.publisher ?? row.sourceName) || null,
        symbols,
      });
    }
    return out;
  }

  private parseFmpPressReleaseRows(
    raw: unknown,
    warnings: string[],
    label: string,
  ): FmpPressReleaseDto[] {
    if (raw != null && typeof raw === 'object' && !Array.isArray(raw) && this.isFmpErrorPayload(raw)) {
      warnings.push(`${label}: ${this.fmpErrorMessage(raw) ?? 'FMP Error Message'}`);
      return [];
    }
    const rows = this.fmpExtractNewsArrayRecords(raw);
    if (!rows) {
      if (raw != null && !this.isFmpErrorPayload(raw)) {
        warnings.push(`${label}: unexpected JSON (expected an array or known wrapper)`);
      }
      return [];
    }
    const out: FmpPressReleaseDto[] = [];
    for (const row of rows) {
      const title = this.str(row.title ?? row.headline ?? row.name);
      if (!title) continue;
      out.push({
        published_at:
          this.str(
            row.date ??
              row.publishedDate ??
              row.published_date ??
              row.releaseDate ??
              row.publishedTime,
          ) || null,
        title,
        text: this.str(row.text ?? row.content ?? row.description ?? row.snippet) || null,
        url: this.str(row.link ?? row.url ?? row.article_url) || null,
      });
    }
    return out;
  }

  async listSecurityFmpNewsFromDb(
    securityId: string,
    options?: { stockNewsLimit?: number; pressReleasesLimit?: number },
  ): Promise<FmpStockNewsBundleDto> {
    if (!this.adminClient) {
      throw new BadRequestException('Supabase client not configured');
    }
    const id = securityId?.trim();
    if (!id) {
      throw new BadRequestException('securityId is required');
    }

    const { data: sec, error: secErr } = await this.adminClient
      .from('securities')
      .select('id, ticker')
      .eq('id', id)
      .maybeSingle();
    if (secErr || !sec?.ticker) {
      throw new NotFoundException('Security not found');
    }
    const ticker = String(sec.ticker).trim().toUpperCase();
    const stockTake = Math.min(100, Math.max(1, options?.stockNewsLimit ?? 10));
    const pressTake = Math.min(100, Math.max(1, options?.pressReleasesLimit ?? 10));

    const { data: stockRows, error: e1 } = await this.adminClient
      .from('security_fmp_news_items')
      .select('*')
      .eq('security_id', id)
      .eq('channel', 'stock_news')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('fetched_at', { ascending: false })
      .limit(stockTake);
    if (e1) {
      throw new BadRequestException(e1.message);
    }

    const { data: pressRows, error: e2 } = await this.adminClient
      .from('security_fmp_news_items')
      .select('*')
      .eq('security_id', id)
      .eq('channel', 'press_release')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('fetched_at', { ascending: false })
      .limit(pressTake);
    if (e2) {
      throw new BadRequestException(e2.message);
    }

    const stock_news = (stockRows ?? []).map((r) =>
      this.mapDbFmpNewsRowToStockArticle(r as Record<string, unknown>),
    );
    const press_releases = (pressRows ?? []).map((r) =>
      this.mapDbFmpNewsRowToPressRelease(r as Record<string, unknown>),
    );

    return { ticker, stock_news, press_releases, warnings: [] };
  }

  async ingestSecurityFmpNewsFromFmp(
    securityId: string,
    options?: { stockNewsLimit?: number; pressReleasesLimit?: number },
  ): Promise<IngestSecurityFmpNewsResult> {
    if (!this.adminClient) {
      throw new BadRequestException('Supabase client not configured');
    }
    const id = securityId?.trim();
    if (!id) {
      throw new BadRequestException('securityId is required');
    }

    const { data: sec, error: secErr } = await this.adminClient
      .from('securities')
      .select('id, ticker')
      .eq('id', id)
      .maybeSingle();
    if (secErr || !sec?.ticker) {
      throw new NotFoundException('Security not found');
    }
    const ticker = String(sec.ticker).trim().toUpperCase();

    const bundle = await this.fetchStockNewsBundle(ticker, options);
    const bodyMax = 14_000;

    const stockRows = bundle.stock_news.map((n) => {
      const publishedKey = n.published_at?.trim() ?? '';
      const content_hash = this.hashFmpNewsRow('stock_news', publishedKey, n.url, n.title);
      const published_at = this.parseFmpPublishedToIsoOrNull(n.published_at);
      return {
        security_id: id,
        channel: 'stock_news' as const,
        published_at,
        title: n.title,
        body: this.truncateFmpText(n.summary, bodyMax),
        url: n.url,
        site_name: n.source,
        content_hash,
        source_payload: { symbols: n.symbols },
        fetched_at: new Date().toISOString(),
      };
    });

    const pressRows = bundle.press_releases.map((p) => {
      const publishedKey = p.published_at?.trim() ?? '';
      const content_hash = this.hashFmpNewsRow('press_release', publishedKey, p.url, p.title);
      const published_at = this.parseFmpPublishedToIsoOrNull(p.published_at);
      return {
        security_id: id,
        channel: 'press_release' as const,
        published_at,
        title: p.title,
        body: this.truncateFmpText(p.text, bodyMax),
        url: p.url,
        site_name: null as string | null,
        content_hash,
        source_payload: {},
        fetched_at: new Date().toISOString(),
      };
    });

    const all = [...stockRows, ...pressRows];
    let upserted = 0;
    if (all.length > 0) {
      const { error, count } = await this.adminClient.from('security_fmp_news_items').upsert(all, {
        onConflict: 'security_id,content_hash',
        count: 'exact',
      });
      if (error) {
        throw new BadRequestException(error.message);
      }
      upserted = typeof count === 'number' ? count : all.length;
    }

    return {
      security_id: id,
      ticker,
      upserted,
      stock_news_rows: stockRows.length,
      press_release_rows: pressRows.length,
      warnings: bundle.warnings,
    };
  }

  private hashFmpNewsRow(
    channel: string,
    publishedKey: string,
    url: string | null,
    title: string,
  ): string {
    const u = (url ?? '').trim().toLowerCase();
    const t = title.trim().toLowerCase();
    return createHash('sha256').update(`${channel}|${publishedKey}|${u}|${t}`).digest('hex');
  }

  private truncateFmpText(text: string | null, maxLen: number): string | null {
    if (text == null) return null;
    const s = String(text);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen - 1)}…`;
  }

  private parseFmpPublishedToIsoOrNull(raw: string | null): string | null {
    if (!raw?.trim()) return null;
    const s = raw.trim();
    let d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      const normalized = s.includes('T') ? s : s.replace(' ', 'T');
      d = new Date(normalized);
    }
    if (Number.isNaN(d.getTime())) {
      return null;
    }
    return d.toISOString();
  }

  private isoOrNullFromTimestamptz(v: unknown): string | null {
    if (v == null) return null;
    const d = new Date(v as string | number | Date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  private mapDbFmpNewsRowToStockArticle(row: Record<string, unknown>): FmpStockNewsArticleDto {
    const payload = row.source_payload;
    const symbols: string[] =
      payload != null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      Array.isArray((payload as { symbols?: unknown }).symbols)
        ? ((payload as { symbols: unknown[] }).symbols.filter((x): x is string => typeof x === 'string'))
        : [];
    return {
      published_at: this.isoOrNullFromTimestamptz(row.published_at),
      title: this.str(row.title),
      summary: row.body != null ? String(row.body) : null,
      url: row.url != null ? String(row.url) : null,
      source: row.site_name != null ? String(row.site_name) : null,
      symbols,
    };
  }

  private mapDbFmpNewsRowToPressRelease(row: Record<string, unknown>): FmpPressReleaseDto {
    return {
      published_at: this.isoOrNullFromTimestamptz(row.published_at),
      title: this.str(row.title),
      text: row.body != null ? String(row.body) : null,
      url: row.url != null ? String(row.url) : null,
    };
  }

  /**
   * Pull one FMP series for the given chart range and upsert into `security_price_bars`.
   * Range → FMP path (same as {@link fetchStockChartLiveFromFmp}):
   *   1D → /api/v3/historical-chart/5min/{symbol}
   *   5D → /api/v3/historical-chart/15min/{symbol}
   *   1M…MAX → /api/v3/historical-price-full/{symbol}?serietype=line
   */
  async ingestStockChartBarsForSecurity(
    securityId: string,
    range: FmpStockChartRange,
  ): Promise<IngestStockChartBarsResult> {
    if (!this.adminClient) {
      throw new BadRequestException('Supabase client not configured');
    }
    if (!this.getApiKey()) {
      throw new BadRequestException('FMP_API_KEY not configured');
    }
    const id = securityId?.trim();
    if (!id) {
      throw new BadRequestException('securityId is required');
    }

    const { data: sec, error: secErr } = await this.adminClient
      .from('securities')
      .select('id, ticker')
      .eq('id', id)
      .maybeSingle();
    if (secErr || !sec?.ticker) {
      throw new NotFoundException('Security not found');
    }

    const ticker = String(sec.ticker).trim().toUpperCase();
    const intervals: Partial<Record<SecurityPriceBarInterval, number>> = {};
    const errors: string[] = [];

    const interval = this.chartDbIntervalForRange(range);
    const path = this.fmpPathForRange(ticker, range);

    try {
      let raw: unknown;

      if (interval === '1d') {
        raw = await this.fmpFetchDailyLineRaw(ticker);
        if (this.isFmpErrorPayload(raw)) {
          errors.push(`FMP daily: ${this.fmpErrorMessage(raw) ?? 'Error Message'}`);
          raw = null;
        } else if (raw == null) {
          errors.push(
            `FMP daily: no usable response for ${ticker} (v3 historical-price-full?serietype=line and stable historical-price-eod/light). Check FMP_API_KEY and plan.`,
          );
        }
      } else {
        raw = await this.fmpGetRawForPath(path, {
          passThroughErrorObject: true,
        });

        if (this.isFmpErrorPayload(raw)) {
          errors.push(`FMP: ${this.fmpErrorMessage(raw) ?? 'Error Message'} (path: ${path})`);
          raw = null;
        } else if (raw == null) {
          errors.push(
            `FMP: no usable JSON for ${path} (HTTP error or parse failure). Check FMP_API_KEY and network.`,
          );
        }

        // v3 intraday often returns [] on free keys; stable query-param endpoint may still work.
        if (raw == null || (Array.isArray(raw) && raw.length === 0)) {
          const stablePath = `/stable/historical-chart/${interval}?symbol=${encodeURIComponent(ticker)}`;
          this.logger.log(`ingest ${ticker}: retry intraday via stable ${stablePath}`);
          const raw2 = await this.fmpGetRawForPath(stablePath, {
            passThroughErrorObject: true,
          });
          if (this.isFmpErrorPayload(raw2)) {
            errors.push(`FMP stable: ${this.fmpErrorMessage(raw2) ?? 'Error Message'}`);
          } else if (raw2 != null) {
            raw = raw2;
          }
        }
      }

      if (raw == null || this.isFmpErrorPayload(raw)) {
        intervals[interval] = 0;
        return { security_id: id, ticker, chart_range: range, intervals, errors };
      }

      const parsedCount = this.extractFmpPriceRows(raw).length;
      if (parsedCount === 0) {
        if (interval === '1d') {
          errors.push(
            `FMP: no daily line points parsed for ${ticker} (empty historical or unexpected JSON shape).`,
          );
        } else if (Array.isArray(raw)) {
          errors.push(
            `FMP: intraday returned an empty array for ${ticker} (${interval}). A paid FMP tier is usually required for 5m/15m historical-chart data.`,
          );
        } else {
          errors.push(
            `FMP: could not parse intraday rows for ${ticker} (expected a JSON array of OHLCV points).`,
          );
        }
      }

      const rows =
        interval === '1d'
          ? this.buildDailyBarRowsForUpsert(id, raw)
          : this.buildIntradayBarRowsForUpsert(id, interval as '5min' | '15min', raw);

      if (rows.length === 0 && parsedCount > 0) {
        errors.push(
          `FMP: ${parsedCount} raw rows but none had a valid date+close (check field types from FMP).`,
        );
      }

      const n = await this.upsertSecurityPriceBars(rows);
      intervals[interval] = n;
      if (interval === '5min' && rows.length > 0) {
        await this.pruneFiveMinuteBarsToLatestDay(id, rows);
      }
      if (interval === '15min' && rows.length > 0) {
        await this.pruneFifteenMinuteBarsToLatestTenDays(id, rows);
      }
      if (interval === '1d' && rows.length > 0) {
        await this.pruneDailyBarsToLatestFiveYears(id, rows);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${interval}: ${msg}`);
      this.logger.warn(`ingest ${ticker} ${interval} range=${range}: ${msg}`);
    }

    return { security_id: id, ticker, chart_range: range, intervals, errors };
  }

  private async lookupSecurityIdByTicker(tickerUpper: string): Promise<string | null> {
    if (!this.adminClient) return null;
    const { data, error } = await this.adminClient
      .from('securities')
      .select('id')
      .eq('market', 'stocks')
      .eq('locale', 'us')
      .eq('ticker', tickerUpper)
      .maybeSingle();
    if (error || !data?.id) return null;
    return data.id as string;
  }

  /** Map chart range → DB interval column value (matches ingest jobs). */
  private chartDbIntervalForRange(range: FmpStockChartRange): SecurityPriceBarInterval {
    if (range === '1D') return '5min';
    if (range === '5D') return '15min';
    // 1M and all longer ranges use daily line bars
    return '1d';
  }

  /** Widen lower bound so session edges are included when querying the DB. */
  private dbQueryLowerIsoForRange(range: FmpStockChartRange): string {
    const now = Date.now();
    if (range === '1D') return new Date(now - 2 * 86400000).toISOString();
    if (range === '5D') return new Date(now - 10 * 86400000).toISOString();
    if (range === '1M') return new Date(now - 45 * 86400000).toISOString();
    if (range === '3M') return new Date(now - 120 * 86400000).toISOString();
    if (range === '6M') return new Date(now - 200 * 86400000).toISOString();
    if (range === 'YTD') return new Date(new Date().getFullYear(), 0, 1).toISOString();
    if (range === '1Y') return new Date(now - 400 * 86400000).toISOString();
    if (range === '5Y') return new Date(now - 6 * 365 * 86400000).toISOString();
    if (range === 'MAX') return '1970-01-01T00:00:00.000Z';
    return new Date(now - 400 * 86400000).toISOString();
  }

  private async tryLoadStockChartFromDatabase(
    securityId: string,
    range: FmpStockChartRange,
  ): Promise<FmpStockChartPoint[]> {
    if (!this.adminClient) return [];
    const interval = this.chartDbIntervalForRange(range);
    const lowerIso = this.dbQueryLowerIsoForRange(range);
    const { data, error } = await this.adminClient
      .from('security_price_bars')
      .select('bar_start, open, high, low, close, volume')
      .eq('security_id', securityId)
      .eq('interval', interval)
      .gte('bar_start', lowerIso)
      .order('bar_start', { ascending: true });
    if (error) {
      this.logger.warn(`tryLoadStockChartFromDatabase: ${error.message}`);
      return [];
    }
    const rows = (data ?? []) as {
      bar_start: string;
      open: string | number | null;
      high: string | number | null;
      low: string | number | null;
      close: string | number;
      volume: string | number | null;
    }[];
    const millis = rows
      .map((r) => {
        const ts = new Date(r.bar_start).getTime();
        const close = Number(r.close);
        const openV = r.open != null ? Number(r.open) : null;
        const highV = r.high != null ? Number(r.high) : null;
        const lowV = r.low != null ? Number(r.low) : null;
        const volume = r.volume != null ? Number(r.volume) : null;
        return {
          ts,
          open: openV != null && Number.isFinite(openV) ? openV : null,
          high: highV != null && Number.isFinite(highV) ? highV : null,
          low: lowV != null && Number.isFinite(lowV) ? lowV : null,
          close,
          volume: volume != null && Number.isFinite(volume) ? volume : null,
        };
      })
      .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.close));
    return this.finalizeMillisPointsToChart(millis, range);
  }

  private extractFmpPriceRows(raw: unknown): FmpRawPriceRow[] {
    if (Array.isArray(raw)) return raw as FmpRawPriceRow[];
    if (
      raw &&
      typeof raw === 'object' &&
      Array.isArray((raw as { historical?: unknown[] }).historical)
    ) {
      return ((raw as { historical: FmpRawPriceRow[] }).historical ?? []) as FmpRawPriceRow[];
    }
    return [];
  }

  private rawRowsToMillisBars(rows: FmpRawPriceRow[]): MillisBarPoint[] {
    return rows
      .map((p) => {
        const ts = p.date ? new Date(p.date).getTime() : NaN;
        // v3 line / full: `close` or `adjClose`. Stable EOD light: `price` (see FMP “Stock Chart Light” docs).
        const closeRaw =
          p.close != null && p.close !== ''
            ? p.close
            : p.adjClose != null && p.adjClose !== ''
              ? p.adjClose
              : p.price != null && p.price !== ''
                ? p.price
                : undefined;
        const close = Number(closeRaw);
        // open/high/low may be absent (daily serietype=line returns only date + close)
        const openV = p.open != null ? Number(p.open) : null;
        const highV = p.high != null ? Number(p.high) : null;
        const lowV = p.low != null ? Number(p.low) : null;
        const volume = p.volume != null ? Number(p.volume) : null;
        return {
          ts,
          open: openV != null && Number.isFinite(openV) ? openV : null,
          high: highV != null && Number.isFinite(highV) ? highV : null,
          low: lowV != null && Number.isFinite(lowV) ? lowV : null,
          close,
          volume: volume != null && Number.isFinite(volume) ? volume : null,
        };
      })
      .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.close));
  }

  private applyChartRangeCutoff(millis: MillisBarPoint[], range: FmpStockChartRange): MillisBarPoint[] {
    const now = Date.now();
    const ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    const cutoffMs: Record<FmpStockChartRange, number | null> = {
      '1D':  now - 1 * 86400000,
      '5D':  now - 5 * 86400000,
      '1M':  now - 30 * 86400000,
      '3M':  now - 90 * 86400000,
      '6M':  now - 180 * 86400000,
      'YTD': ytdStart,
      '1Y':  now - 365 * 86400000,
      '5Y':  now - 5 * 365 * 86400000,
      'MAX': null,
    };
    const cutoff = cutoffMs[range];
    return millis
      .filter((p) => cutoff === null || p.ts >= cutoff)
      .sort((a, b) => a.ts - b.ts);
  }

  private millisBarsToChartPoints(millis: MillisBarPoint[]): FmpStockChartPoint[] {
    return millis.map((p) => ({
      ts: new Date(p.ts).toISOString(),
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume,
    }));
  }

  private finalizeMillisPointsToChart(
    millis: MillisBarPoint[],
    range: FmpStockChartRange,
  ): FmpStockChartPoint[] {
    return this.millisBarsToChartPoints(this.applyChartRangeCutoff(millis, range));
  }

  /**
   * Resolve the correct FMP path for a given range, following the endpoint table:
   *   1D  → /api/v3/historical-chart/5min/{symbol}
   *   5D  → /api/v3/historical-chart/15min/{symbol}
   *   1M… → /api/v3/historical-price-full/{symbol}?serietype=line  (close only; see {@link fmpFetchDailyLineRaw})
   */
  private fmpPathForRange(normalizedTicker: string, range: FmpStockChartRange): string {
    const enc = encodeURIComponent(normalizedTicker);
    if (range === '1D') return `/api/v3/historical-chart/5min/${enc}`;
    if (range === '5D') return `/api/v3/historical-chart/15min/${enc}`;
    return `/api/v3/historical-price-full/${enc}?serietype=line`;
  }

  /**
   * Daily “line” chart data: prefer legacy v3 `historical-price-full?serietype=line`,
   * then fall back to **stable** `historical-price-eod/light` (same date+close idea).
   * Many keys / networks fail on the v3 URL with HTTP errors or non-JSON; stable is the supported surface.
   */
  private async fmpFetchDailyLineRaw(normalizedTicker: string): Promise<unknown> {
    const enc = encodeURIComponent(normalizedTicker);
    const v3 = `/api/v3/historical-price-full/${enc}?serietype=line`;
    const tryV3 = await this.fmpGetRawForPath(v3, { passThroughErrorObject: true });
    const v3Rows =
      tryV3 != null && !this.isFmpErrorPayload(tryV3)
        ? this.extractFmpPriceRows(tryV3)
        : [];
    if (v3Rows.length > 0) {
      return tryV3;
    }

    const stable = `/stable/historical-price-eod/light?symbol=${enc}`;
    this.logger.log(
      `FMP daily ${normalizedTicker}: v3 line unavailable or empty (${v3Rows.length} rows), using stable ${stable}`,
    );
    return await this.fmpGetRawForPath(stable, { passThroughErrorObject: true });
  }

  private async fetchStockChartLiveFromFmp(
    normalizedTicker: string,
    range: FmpStockChartRange,
  ): Promise<{ symbol: string; range: FmpStockChartRange; points: FmpStockChartPoint[] }> {
    const raw =
      range === '1D' || range === '5D'
        ? await this.fmpGetRawForPath(this.fmpPathForRange(normalizedTicker, range))
        : await this.fmpFetchDailyLineRaw(normalizedTicker);
    const millis = this.rawRowsToMillisBars(this.extractFmpPriceRows(raw));
    const points = this.finalizeMillisPointsToChart(millis, range);
    return { symbol: normalizedTicker, range, points };
  }

  private buildIntradayBarRowsForUpsert(
    securityId: string,
    interval: '5min' | '15min',
    raw: unknown,
  ): Record<string, unknown>[] {
    const millis = this.rawRowsToMillisBars(this.extractFmpPriceRows(raw));
    return millis.map((p) => ({
      security_id: securityId,
      interval,
      bar_start: new Date(p.ts).toISOString(),
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume != null ? Math.round(Math.min(p.volume, 9e15)) : null,
      source: 'fmp',
    }));
  }

  /**
   * Daily line bars — FMP serietype=line returns only { date, close }.
   * open / high / low are stored as NULL.
   */
  private buildDailyBarRowsForUpsert(securityId: string, raw: unknown): Record<string, unknown>[] {
    const millis = this.rawRowsToMillisBars(this.extractFmpPriceRows(raw));
    return millis.map((p) => ({
      security_id: securityId,
      interval: '1d' as const,
      bar_start: new Date(p.ts).toISOString(),
      open: null,
      high: null,
      low: null,
      close: p.close,
      volume: p.volume != null ? Math.round(Math.min(p.volume, 9e15)) : null,
      source: 'fmp',
    }));
  }

  private async upsertSecurityPriceBars(rows: Record<string, unknown>[]): Promise<number> {
    if (!this.adminClient || rows.length === 0) return 0;
    const chunk = 400;
    let total = 0;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const { error } = await this.adminClient.from('security_price_bars').upsert(slice, {
        onConflict: 'security_id,interval,bar_start',
      });
      if (error) {
        throw new Error(error.message);
      }
      total += slice.length;
    }
    return total;
  }

  /**
   * Requirement: keep only the latest rolling 48h of 5min bars per security.
   * We derive the upper bound from the max bar_start in the ingested batch.
   */
  private async pruneFiveMinuteBarsToLatestDay(
    securityId: string,
    ingestedRows: Record<string, unknown>[],
  ): Promise<void> {
    if (!this.adminClient || ingestedRows.length === 0) return;
    const starts = ingestedRows
      .map((r) => this.str(r.bar_start))
      .map((iso) => new Date(iso))
      .filter((d) => !Number.isNaN(d.getTime()))
      .map((d) => d.getTime());
    if (starts.length === 0) return;

    const latestMs = Math.max(...starts);
    const cutoffIso = new Date(latestMs - 48 * 60 * 60 * 1000).toISOString();

    const { error } = await this.adminClient
      .from('security_price_bars')
      .delete()
      .eq('security_id', securityId)
      .eq('interval', '5min')
      .lt('bar_start', cutoffIso);
    if (error) {
      throw new Error(`failed pruning old 5min bars: ${error.message}`);
    }
  }

  /**
   * Requirement: keep only the latest rolling 10 days of 15min bars per security.
   * We derive the upper bound from the max bar_start in the ingested batch.
   */
  private async pruneFifteenMinuteBarsToLatestTenDays(
    securityId: string,
    ingestedRows: Record<string, unknown>[],
  ): Promise<void> {
    if (!this.adminClient || ingestedRows.length === 0) return;
    const starts = ingestedRows
      .map((r) => this.str(r.bar_start))
      .map((iso) => new Date(iso))
      .filter((d) => !Number.isNaN(d.getTime()))
      .map((d) => d.getTime());
    if (starts.length === 0) return;

    const latestMs = Math.max(...starts);
    const cutoffIso = new Date(latestMs - 10 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await this.adminClient
      .from('security_price_bars')
      .delete()
      .eq('security_id', securityId)
      .eq('interval', '15min')
      .lt('bar_start', cutoffIso);
    if (error) {
      throw new Error(`failed pruning old 15min bars: ${error.message}`);
    }
  }

  /**
   * Requirement: keep only the latest rolling 5 years of 1d bars per security.
   * We derive the upper bound from the max bar_start in the ingested batch.
   */
  private async pruneDailyBarsToLatestFiveYears(
    securityId: string,
    ingestedRows: Record<string, unknown>[],
  ): Promise<void> {
    if (!this.adminClient || ingestedRows.length === 0) return;
    const starts = ingestedRows
      .map((r) => this.str(r.bar_start))
      .map((iso) => new Date(iso))
      .filter((d) => !Number.isNaN(d.getTime()))
      .map((d) => d.getTime());
    if (starts.length === 0) return;

    const latestMs = Math.max(...starts);
    const cutoffIso = new Date(latestMs - 5 * 365 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await this.adminClient
      .from('security_price_bars')
      .delete()
      .eq('security_id', securityId)
      .eq('interval', '1d')
      .lt('bar_start', cutoffIso);
    if (error) {
      throw new Error(`failed pruning old 1d bars: ${error.message}`);
    }
  }

  async syncTickerToSecurities(symbol: string): Promise<FmpSyncTickerResult> {
    const normalized = String(symbol ?? '').trim();
    if (!normalized) {
      return { ok: false, code: 'not_found', message: 'ticker is required' };
    }
    const profile = await this.fetchProfileFromApi(normalized);
    if (!profile) {
      return {
        ok: false,
        code: 'not_found',
        message: `No profile for symbol ${normalized}`,
      };
    }
    const filters = await this.stockIngestFiltersService.loadRowForIngest();
    const snap = buildIngestSnapshotFromProfile(profile);
    const verdict = evaluateIngestAgainstFilters(filters, snap);
    if (!verdict.ok) {
      this.logger.log(`Ingest filter rejected ${normalized}: ${verdict.reason}`);
      return { ok: false, code: 'filtered', message: verdict.reason };
    }
    const row = this.mapProfileToSecuritiesRow(profile, snap);
    if (!this.adminClient) {
      this.logger.warn('Supabase client not configured');
      return {
        ok: false,
        code: 'not_found',
        message: 'Supabase client not configured',
      };
    }
    const { data: upserted, error } = await this.adminClient
      .from('securities')
      .upsert(row, {
        onConflict: 'market,locale,ticker',
      })
      .select('id')
      .single();
    if (error) {
      this.logger.warn(`securities upsert failed: ${error.message}`);
      return {
        ok: false,
        code: 'not_found',
        message: error.message,
      };
    }
    this.logger.log(`Synced symbol=${normalized} to securities id=${upserted?.id}`);
    return upserted?.id
      ? { ok: true, security_id: upserted.id }
      : {
          ok: false,
          code: 'not_found',
          message: 'Upsert returned no id',
        };
  }

  private str(v: unknown): string {
    return v == null ? '' : String(v).trim();
  }

  private fmpParseArray(data: unknown): Record<string, unknown>[] | null {
    if (data == null) return null;
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (typeof data === 'object' && data !== null && 'Error Message' in data) {
      return null;
    }
    return null;
  }

  /** v3 arrays or stable `{ data: [...] }`-style wrappers. */
  private fmpExtractNewsArrayRecords(raw: unknown): Record<string, unknown>[] | null {
    if (this.isFmpErrorPayload(raw)) return null;
    const direct = this.fmpParseArray(raw);
    if (direct) return direct;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    for (const key of ['data', 'content', 'results', 'news', 'items']) {
      const inner = o[key];
      if (Array.isArray(inner)) {
        return inner as Record<string, unknown>[];
      }
    }
    return null;
  }

  private resolveSecurityId(
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

  private isFmpErrorPayload(data: unknown): data is { 'Error Message': string } {
    return (
      data != null &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      'Error Message' in data &&
      typeof (data as { 'Error Message': unknown })['Error Message'] === 'string'
    );
  }

  private fmpErrorMessage(data: unknown): string | null {
    if (!this.isFmpErrorPayload(data)) return null;
    return (data as { 'Error Message': string })['Error Message'].trim() || null;
  }

  /**
   * @param passThroughErrorObject — when true, JSON bodies that contain FMP's
   *   `Error Message` key are returned as-is so callers can surface them (ingest UX).
   */
  private async fmpGetRawForPath(
    path: string,
    opts?: { passThroughErrorObject?: boolean },
  ): Promise<unknown> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('FMP_API_KEY not configured');
      return null;
    }
    const baseUrl = this.getBaseUrl().replace(/\/$/, '');
    const sep = path.includes('?') ? '&' : '?';
    const url = `${baseUrl}${path}${sep}apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    } catch {
      this.logger.warn(
        `FMP ${path}: invalid JSON (HTTP ${res.status}) — ${text.slice(0, 180).replace(/\s+/g, ' ')}`,
      );
      return null;
    }
    if (!res.ok) {
      const hint =
        typeof data === 'object' &&
        data !== null &&
        'Error Message' in (data as object) &&
        typeof (data as { 'Error Message': unknown })['Error Message'] === 'string'
          ? (data as { 'Error Message': string })['Error Message']
          : text.slice(0, 180).replace(/\s+/g, ' ');
      this.logger.warn(`FMP ${path} -> HTTP ${res.status}: ${hint}`);
      return null;
    }
    if (data && typeof data === 'object' && !Array.isArray(data) && this.isFmpErrorPayload(data)) {
      const msg = this.fmpErrorMessage(data);
      this.logger.warn(`FMP ${path}: ${msg ?? 'Error Message'}`);
      if (opts?.passThroughErrorObject === true) {
        return data;
      }
      return null;
    }
    return data;
  }

  /** All active securities (paginated — avoids PostgREST default row cap). */
  private async loadActiveSecuritiesTickerMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!this.adminClient) return map;
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await this.adminClient
        .from('securities')
        .select('id, ticker')
        .eq('active', true)
        .range(from, from + pageSize - 1);
      if (error) {
        this.logger.warn(`loadActiveSecuritiesTickerMap: ${error.message}`);
        break;
      }
      const rows = data ?? [];
      for (const s of rows) {
        const r = s as { id: string; ticker: string };
        map.set(r.ticker.trim().toUpperCase(), r.id);
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return map;
  }

  private async collectSymbolsFromPoliticalFeeds(): Promise<Set<string>> {
    const symbols = new Set<string>();
    const endpoints = ['/stable/senate-latest', '/stable/house-latest'] as const;
    const pageLimit = 100;
    const maxPages = 24;
    for (const basePath of endpoints) {
      for (let page = 0; page < maxPages; page++) {
        const path = `${basePath}?page=${page}&limit=${pageLimit}`;
        const raw = await this.fmpGetRawForPath(path);
        const data = this.fmpParseArray(raw);
        if (!data || data.length === 0) break;
        for (const row of data) {
          const rec = row as Record<string, unknown>;
          const symRaw = this.str(rec.symbol ?? rec.ticker);
          if (symRaw) symbols.add(symRaw.trim().toUpperCase());
        }
        if (data.length < pageLimit) break;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    return symbols;
  }

  /**
   * Scan FMP senate/house latest feeds for symbols not present in `securities`, then
   * fetch each profile and upsert (same rules as {@link syncTickerToSecurities}).
   */
  async syncMissingPoliticalFeedSymbolsToSecurities(options?: {
    delayMs?: number;
    limit?: number | null;
    dryRun?: boolean;
  }): Promise<FmpSyncPoliticalFeedMissingSecuritiesResult> {
    const delayMs = Math.max(0, options?.delayMs ?? 250);
    const limit = options?.limit != null && options.limit > 0 ? options.limit : null;
    const dryRun = options?.dryRun === true;

    const out: FmpSyncPoliticalFeedMissingSecuritiesResult = {
      dryRun,
      uniqueSymbolsInFeeds: 0,
      missingInSecurities: 0,
      toProcess: 0,
      synced: 0,
      filtered: 0,
      notFound: 0,
      failed: 0,
      errors: [],
    };

    if (!this.getApiKey()) {
      out.errors.push('FMP_API_KEY not configured');
      return out;
    }
    if (!this.adminClient) {
      out.errors.push('Supabase client not configured');
      return out;
    }

    const secByTicker = await this.loadActiveSecuritiesTickerMap();
    const allSyms = await this.collectSymbolsFromPoliticalFeeds();
    out.uniqueSymbolsInFeeds = allSyms.size;

    const missing: string[] = [];
    for (const sym of allSyms) {
      if (!this.resolveSecurityId(secByTicker, sym)) missing.push(sym);
    }
    missing.sort();
    out.missingInSecurities = missing.length;

    const toProcess = limit != null ? missing.slice(0, limit) : missing;
    out.toProcess = toProcess.length;

    if (dryRun) return out;

    for (let i = 0; i < toProcess.length; i++) {
      const ticker = toProcess[i]!;
      const result = await this.syncTickerToSecurities(ticker);
      if (result.ok) {
        out.synced++;
        secByTicker.set(ticker, result.security_id);
      } else if (result.code === 'filtered') {
        out.filtered++;
      } else {
        const msg = result.message ?? '';
        if (/No profile for symbol/i.test(msg)) {
          out.notFound++;
        } else {
          out.failed++;
          if (out.errors.length < 40) out.errors.push(`${ticker}: ${msg}`);
        }
      }
      if (delayMs > 0 && i < toProcess.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return out;
  }
}
