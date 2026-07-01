/**
 * Sync tickers from FMP API to securities table (profile + map + upsert).
 * Respects platform_stock_ingest_filters (same rules as FmpService).
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

if (!API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Need FMP_API_KEY, SUPABASE_URL, and Supabase key in env');
  process.exit(1);
}

function mapProfileToRow(r, snap) {
  const listDate = r.ipoDate ?? null;
  const employees = r.fullTimeEmployees != null ? r.fullTimeEmployees : (r.employees != null ? r.employees : null);
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
    list_date: listDate && /^\d{4}-\d{2}-\d{2}$/.test(String(listDate).slice(0, 10)) ? String(listDate).slice(0, 10) : null,
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
    console.error(`${symbol}: API error ${res.status}`, data);
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) {
    console.error(`${symbol}: No profile`);
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
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const filters = await loadIngestFilters(supabase);
  const tickers = ['NVDA', 'AAPL'];

  for (const ticker of tickers) {
    console.log(`Fetching ${ticker}...`);
    const profile = await fetchProfile(ticker);
    if (!profile) continue;
    const snap = buildIngestSnapshotFromProfile(profile);
    const verdict = evaluateIngestAgainstFilters(filters, snap);
    if (!verdict.ok) {
      console.warn(`${ticker}: skipped by ingest filters — ${verdict.reason}`);
      continue;
    }
    const row = mapProfileToRow(profile, snap);
    const { data, error } = await supabase
      .from('securities')
      .upsert(row, { onConflict: 'market,locale,ticker' })
      .select('id, ticker, name')
      .single();
    if (error) {
      console.error(`${ticker}: upsert failed`, error.message);
      continue;
    }
    console.log(`${ticker}: synced -> security_id=${data.id}, name=${data.name}`);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
