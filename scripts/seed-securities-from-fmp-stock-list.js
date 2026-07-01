/**
 * Pull FMP company symbol list (/stable/stock-list) and upsert minimal rows into securities.
 * Run before: node scripts/seed-all-securities-from-fmp.js (full profile enrichment).
 *
 * Note: FMP stable/stock-list often omits exchange fields. When US-only mode and exchange is blank,
 * we drop tickers whose last segment after "." looks like a non-US listing (.L, .TO, .V, .CN, .NE).
 *
 * Env: FMP_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY with insert)
 *
 * Usage:
 *   node scripts/seed-securities-from-fmp-stock-list.js
 *   node scripts/seed-securities-from-fmp-stock-list.js --dry-run
 *   node scripts/seed-securities-from-fmp-stock-list.js --all-markets
 *   node scripts/seed-securities-from-fmp-stock-list.js --limit=500 --chunk=150
 */
require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });

const { createClient } = require('@supabase/supabase-js');

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

const CHUNK = Math.max(50, parseInt(argValue('--chunk=', '200'), 10) || 200);
const LIMIT = (() => {
  const raw = argValue('--limit=', '');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const DRY_RUN = argFlag('--dry-run');
const ALL_MARKETS = argFlag('--all-markets');

/** Broad US listing filter — matches FMP exchangeShortName strings. */
function isUsExchange(exchangeRaw) {
  if (exchangeRaw == null || String(exchangeRaw).trim() === '') return false;
  const u = String(exchangeRaw).toUpperCase();
  if (u.includes('NASDAQ')) return true;
  if (u.includes('NYSE')) return true;
  if (u.includes('AMEX') || u.includes('NYSEAMERICAN') || u.includes('NYSE AMERICAN')) return true;
  if (u.includes('ARCA') || u.includes('NYSEARCA')) return true;
  if (u.includes('BATS')) return true;
  if (u.includes('OTC')) return true;
  if (u === 'US') return true;
  return false;
}

function localeForExchange(exchangeRaw) {
  return isUsExchange(exchangeRaw) ? 'us' : 'global';
}

/** When FMP omits exchange, last suffix after "." in symbol (histogram from stock-list). */
const FOREIGN_TICKER_DOT_SUFFIXES = new Set(['L', 'TO', 'V', 'CN', 'NE']);

function isLikelyForeignListedSymbol(symbolRaw) {
  const s = String(symbolRaw ?? '').trim();
  const i = s.lastIndexOf('.');
  if (i < 0) return false;
  const seg = s.slice(i + 1).toUpperCase();
  return FOREIGN_TICKER_DOT_SUFFIXES.has(seg);
}

function localeForRow(row) {
  const ex = row.exchangeShortName ?? row.stockExchange ?? row.exchange ?? '';
  if (String(ex).trim() !== '') return localeForExchange(ex);
  const sym = String(row.symbol ?? row.ticker ?? '').trim();
  return isLikelyForeignListedSymbol(sym) ? 'global' : 'us';
}

function rowToSecurity(row) {
  const sym = String(row.symbol ?? row.ticker ?? '').trim().toUpperCase();
  if (!sym || sym.length > 32) return null;
  const nameRaw = row.name ?? row.companyName ?? row.company_name ?? sym;
  const name = String(nameRaw).trim() || sym;
  const locale = ALL_MARKETS ? localeForRow(row) : 'us';

  return {
    ticker: sym,
    market: 'stocks',
    locale,
    name: name.slice(0, 512),
    type_code: 'CS',
    type_description: null,
    active: true,
    updated_at: new Date().toISOString(),
  };
}

async function fetchStockList() {
  const url = `${BASE_URL}/stable/stock-list?apikey=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`FMP stock-list HTTP ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && data['Error Message']) {
    throw new Error(`FMP: ${data['Error Message']}`);
  }
  if (!Array.isArray(data)) {
    throw new Error('FMP stock-list: expected array');
  }
  return data;
}

async function main() {
  if (!API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Need FMP_API_KEY, SUPABASE_URL, and Supabase key in env');
    process.exit(1);
  }

  console.log(
    `Fetching FMP stock-list… all-markets=${ALL_MARKETS} dry-run=${DRY_RUN} chunk=${CHUNK}${LIMIT != null ? ` limit=${LIMIT}` : ''}`,
  );

  const rawList = await fetchStockList();
  const mapped = [];
  let skippedNonUs = 0;
  for (const row of rawList) {
    if (!ALL_MARKETS) {
      const ex = row.exchangeShortName ?? row.stockExchange ?? row.exchange ?? '';
      const exStr = String(ex).trim();
      if (exStr) {
        if (!isUsExchange(ex)) {
          skippedNonUs++;
          continue;
        }
      } else if (isLikelyForeignListedSymbol(row.symbol ?? row.ticker)) {
        skippedNonUs++;
        continue;
      }
    }
    const m = rowToSecurity(row);
    if (m) mapped.push(m);
  }

  /** de-dupe last-wins by (market,locale,ticker) */
  const byKey = new Map();
  for (const m of mapped) {
    byKey.set(`${m.market}|${m.locale}|${m.ticker}`, m);
  }
  let unique = [...byKey.values()];
  if (LIMIT != null) unique = unique.slice(0, LIMIT);

  console.log(
    `FMP rows: ${rawList.length} → mapped: ${mapped.length} → unique: ${unique.length}${!ALL_MARKETS ? ` (skipped non-US exchanges: ${skippedNonUs})` : ''}`,
  );

  if (DRY_RUN) {
    console.log('Dry run — no database writes. Sample:', unique.slice(0, 5));
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const { error } = await supabase.from('securities').upsert(batch, {
      onConflict: 'market,locale,ticker',
    });
    if (error) {
      console.error(`Chunk ${i / CHUNK + 1}: ${error.message}`);
      failed += batch.length;
    } else {
      ok += batch.length;
    }
  }

  console.log(`\nUpserted rows (attempted): ${ok} failed-rows: ${failed}`);
  console.log('Next: node scripts/seed-all-securities-from-fmp.js');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
