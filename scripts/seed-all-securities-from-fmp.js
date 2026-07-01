/**
 * Refresh securities rows from FMP company profile for every US stock in the DB.
 * Same mapping + optional ingest filters as FmpService / sync-tickers-to-securities.js.
 *
 * Optional first step (bulk tickers from FMP): node scripts/seed-securities-from-fmp-stock-list.js
 *
 * Env: FMP_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY)
 *
 * Usage:
 *   node scripts/seed-all-securities-from-fmp.js
 *   node scripts/seed-all-securities-from-fmp.js --delay=250 --limit=500
 *   node scripts/seed-all-securities-from-fmp.js --only-sparse
 *   node scripts/seed-all-securities-from-fmp.js --bypass-ingest-filters
 *   node scripts/seed-all-securities-from-fmp.js --dry-run
 */
require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });

const { createClient } = require('@supabase/supabase-js');
const {
  buildIngestSnapshotFromProfile,
  evaluateIngestAgainstFilters,
  ingestSecurityTypeToTypeCode,
  defaultPlatformIngestFilters,
} = require('./lib/stock-ingest-filters-eval');

const API_KEY = process.env.FMP_API_KEY;
const BASE_URL = (process.env.FMP_API_BASE_URL || 'https://financialmodelingprep.com').replace(/\/$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

function argFlag(name) {
  return process.argv.includes(name);
}

function argValue(prefix, fallback) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return fallback;
  const v = hit.split('=')[1];
  return v !== undefined && v !== '' ? v : fallback;
}

const DELAY_MS = parseInt(argValue('--delay=', '300'), 10);
const LIMIT = (() => {
  const raw = argValue('--limit=', '');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const DRY_RUN = argFlag('--dry-run');
const ONLY_SPARSE = argFlag('--only-sparse');
const BYPASS_FILTERS = argFlag('--bypass-ingest-filters');

function mapProfileToRow(r, snap) {
  const listDate = r.ipoDate ?? null;
  const employees =
    r.fullTimeEmployees != null ? r.fullTimeEmployees : r.employees != null ? r.employees : null;
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

async function fetchProfile(symbol) {
  const url = `${BASE_URL}/stable/profile?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    console.warn(`  ${symbol}: HTTP ${res.status}`);
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && data['Error Message']) {
    return null;
  }
  return data[0];
}

async function loadIngestFilters(supabase) {
  const { data, error } = await supabase
    .from('platform_stock_ingest_filters')
    .select('*')
    .eq('singleton_key', 'default')
    .maybeSingle();
  if (error) {
    console.warn('Could not load platform_stock_ingest_filters:', error.message);
    return defaultPlatformIngestFilters();
  }
  if (!data) return defaultPlatformIngestFilters();
  return data;
}

async function main() {
  if (!API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Need FMP_API_KEY, SUPABASE_URL, and Supabase key in env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const filters = await loadIngestFilters(supabase);

  const PAGE = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from('securities')
      .select('id, ticker, description, cik, market_cap')
      .eq('market', 'stocks')
      .eq('locale', 'us')
      .eq('active', true)
      .order('ticker')
      .range(from, from + PAGE - 1);

    if (ONLY_SPARSE) {
      q = q.or('description.is.null,cik.is.null');
    }

    const { data: batch, error: selErr } = await q;

    if (selErr) {
      console.error('Failed to list securities:', selErr.message);
      process.exit(1);
    }

    const chunk = batch ?? [];
    if (chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }

  let list = rows;
  if (LIMIT != null) list = list.slice(0, LIMIT);

  console.log(
    `Securities to process: ${list.length}${ONLY_SPARSE ? ' (only-sparse)' : ''}${LIMIT != null ? ` (limit ${LIMIT})` : ''}`,
  );
  console.log(`Delay ${DELAY_MS}ms between FMP calls. bypass-ingest-filters=${BYPASS_FILTERS} dry-run=${DRY_RUN}\n`);

  let synced = 0;
  let filtered = 0;
  let noProfile = 0;
  let failed = 0;

  for (let i = 0; i < list.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));

    const row = list[i];
    const ticker = String(row.ticker ?? '')
      .trim()
      .toUpperCase();
    process.stdout.write(`[${i + 1}/${list.length}] ${ticker} ... `);

    const profile = await fetchProfile(ticker);
    if (!profile) {
      noProfile++;
      console.log('no profile');
      continue;
    }

    const snap = buildIngestSnapshotFromProfile(profile);
    if (!BYPASS_FILTERS) {
      const verdict = evaluateIngestAgainstFilters(filters, snap);
      if (!verdict.ok) {
        filtered++;
        console.log(`filtered (${verdict.reason})`);
        continue;
      }
    }

    const upsertRow = mapProfileToRow(profile, snap);
    if (DRY_RUN) {
      synced++;
      console.log('dry-run ok');
      continue;
    }

    const { error } = await supabase.from('securities').upsert(upsertRow, {
      onConflict: 'market,locale,ticker',
    });
    if (error) {
      failed++;
      console.log(`error: ${error.message}`);
    } else {
      synced++;
      console.log('synced');
    }
  }

  console.log(`\nDone. synced=${synced} filtered=${filtered} no_profile=${noProfile} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
