/**
 * Sync insider trades from FMP (Search Insider Trades API) into insiders + insider_trades.
 * Schedule-ready: run with no args to sync all securities with entity_id, or --symbol=KLC --limit=20 for one ticker.
 * If FMP returns Restricted/Premium, falls back to Latest endpoint and filters by symbol; both may require premium.
 *
 * Usage: node scripts/run-sync-insider-trades.js [--symbol=KLC] [--limit=20] [--dry-run] [--delay=500]
 * Cron: 0 6 * * * cd /path && npm run sync-insider-trades
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const FMP_BASE = (process.env.FMP_API_BASE_URL || 'https://financialmodelingprep.com').replace(/\/$/, '');
const INSIDER_ROLES = ['CEO', 'CFO', 'DIRECTOR', 'CHAIRMAN', 'FOUNDER', 'TEN_PERCENT_OWNER', 'OTHER_EXECUTIVE'];

function mapTypeOfOwnerToRole(typeOfOwner) {
  if (!typeOfOwner || typeof typeOfOwner !== 'string') return 'OTHER_EXECUTIVE';
  const t = typeOfOwner.toUpperCase();
  if (/\bCEO\b/.test(t)) return 'CEO';
  if (/\bCFO\b/.test(t)) return 'CFO';
  if (/\bDIRECTOR\b/.test(t)) return 'DIRECTOR';
  if (/\bCHAIRMAN\b/.test(t) || /\bCHAIR\b/.test(t)) return 'CHAIRMAN';
  if (/\bFOUNDER\b/.test(t)) return 'FOUNDER';
  if (/\b10%|TEN\s*PERCENT|10\s*PERCENT\b/.test(t)) return 'TEN_PERCENT_OWNER';
  return 'OTHER_EXECUTIVE';
}

function mapAcquisitionDispositionToType(acqDisp) {
  const a = (acqDisp || '').toUpperCase();
  if (a === 'A') return 'buy';
  if (a === 'D') return 'sell';
  return 'other';
}

const NAME_SUFFIXES = /^(Jr\.?|Sr\.?|II|III|IV|I|V)$/i;
function parseReportingName(fullName) {
  if (!fullName || typeof fullName !== 'string') return { first_name: null, last_name: null, middle_name: null, name_suffix: null, display_name: null };
  const display = fullName.trim().slice(0, 500);
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: null, last_name: null, middle_name: null, name_suffix: null, display_name: display || null };
  let name_suffix = null;
  if (parts.length > 1 && NAME_SUFFIXES.test(parts[parts.length - 1])) {
    name_suffix = parts.pop();
  }
  const last_name = parts.length ? parts.pop() : null;
  const first_name = parts.length ? parts.shift() : null;
  const middle_name = parts.length ? parts.join(' ') : null;
  return { first_name: first_name?.slice(0, 200) || null, last_name: last_name?.slice(0, 200) || null, middle_name: middle_name?.slice(0, 200) || null, name_suffix: name_suffix?.slice(0, 50) || null, display_name: display || null };
}

async function fetchFmpInsiderTrades(apiKey, symbol, limit = 20, page = 0) {
  const searchUrl = `${FMP_BASE}/stable/insider-trading/search?symbol=${encodeURIComponent(symbol)}&page=${page}&limit=${Math.min(limit, 100)}&apikey=${encodeURIComponent(apiKey)}`;
  const searchRes = await fetch(searchUrl);
  const searchText = await searchRes.text();
  let data;
  try {
    data = JSON.parse(searchText);
  } catch {
    if (/Restricted|upgrade|premium/i.test(searchText)) {
      const latestUrl = `${FMP_BASE}/stable/insider-trading/latest?page=0&limit=500&apikey=${encodeURIComponent(apiKey)}`;
      const latestRes = await fetch(latestUrl);
      const latestText = await latestRes.text();
      let latestData;
      try {
        latestData = JSON.parse(latestText);
      } catch {
        if (/Restricted|upgrade|premium/i.test(latestText)) return { restricted: true, trades: [] };
        throw new Error(latestText.slice(0, 200));
      }
      const list = Array.isArray(latestData) ? latestData : [];
      const bySymbol = list.filter((t) => (t.symbol || t.ticker || '').toUpperCase() === String(symbol).toUpperCase()).slice(0, limit);
      return { restricted: false, trades: bySymbol };
    }
    throw new Error(searchText.slice(0, 200));
  }
  if (!searchRes.ok) throw new Error(data?.['Error Message'] || data?.message || searchRes.statusText);
  return { restricted: false, trades: Array.isArray(data) ? data : [] };
}

async function getOrCreatePersonEntity(supabase, reportingCik, reportingName) {
  const key = (reportingCik || reportingName || '').toString().trim() || null;
  if (!key) return null;
  const entityKey = reportingCik ? `insider_cik_${reportingCik.replace(/^0+/, '')}` : `insider_${(reportingName || '').replace(/\s+/g, '_').slice(0, 80)}`;
  const { data: existing } = await supabase
    .from('entities')
    .select('id')
    .eq('entity_type', 'executive')
    .eq('key', entityKey)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const name = (reportingName || `Insider ${reportingCik || entityKey}`).trim().slice(0, 500);
  const { data: inserted, error } = await supabase
    .from('entities')
    .insert({ entity_type: 'executive', key: entityKey, name })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return inserted?.id || null;
}

async function getOrCreateInsider(supabase, companyEntityId, personEntityId, role, title, reportingCik, nameParts, personCik) {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('insiders')
    .select('id, first_name, last_name')
    .eq('company_entity_id', companyEntityId)
    .eq('person_entity_id', personEntityId)
    .maybeSingle();
  if (existing?.id) {
    const updates = { last_verified_at: now, updated_at: now };
    if (nameParts && (nameParts.first_name != null || nameParts.last_name != null)) {
      if (existing.first_name == null && nameParts.first_name != null) updates.first_name = nameParts.first_name;
      if (existing.last_name == null && nameParts.last_name != null) updates.last_name = nameParts.last_name;
      if (nameParts.middle_name != null) updates.middle_name = nameParts.middle_name;
      if (nameParts.name_suffix != null) updates.name_suffix = nameParts.name_suffix;
      if (nameParts.display_name != null) updates.display_name = nameParts.display_name;
    }
    if (Object.keys(updates).length > 2) {
      await supabase.from('insiders').update(updates).eq('id', existing.id);
    } else {
      await supabase.from('insiders').update({ last_verified_at: now, updated_at: now }).eq('id', existing.id);
    }
    return existing.id;
  }
  const { data: inserted, error } = await supabase
    .from('insiders')
    .insert({
      company_entity_id: companyEntityId,
      person_entity_id: personEntityId,
      role: INSIDER_ROLES.includes(role) ? role : 'OTHER_EXECUTIVE',
      title: title || null,
      reporting_cik: reportingCik || null,
      first_name: nameParts?.first_name ?? null,
      last_name: nameParts?.last_name ?? null,
      middle_name: nameParts?.middle_name ?? null,
      name_suffix: nameParts?.name_suffix ?? null,
      display_name: nameParts?.display_name ?? null,
      person_cik: personCik || reportingCik || null,
      is_current: true,
      source: 'fmp',
      first_seen_at: now,
      last_verified_at: now,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return inserted?.id || null;
}

function parseDate(s) {
  if (!s) return null;
  const str = String(s).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
}

async function run(options = {}) {
  const apiKey = process.env.FMP_API_KEY;
  const symbolArg = options.symbol;
  const limit = Math.min(Number(options.limit) ?? 20, 100);
  const dryRun = !!options.dryRun;
  const delayMs = Number(options.delay) ?? 500;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );

  let securities;
  if (symbolArg) {
    const { data: rows, error } = await supabase
      .from('securities')
      .select('id, entity_id, ticker, name')
      .eq('market', 'stocks')
      .eq('locale', 'us')
      .eq('ticker', String(symbolArg).trim().toUpperCase())
      .limit(1);
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error(`Security not found for symbol ${symbolArg}. Sync profile first (e.g. sync-tickers or enrich).`);
    const sec = rows[0];
    if (!sec.entity_id) throw new Error(`Security ${sec.ticker} has no entity_id. Run enrichment to link entity.`);
    securities = [sec];
  } else {
    const { data: rows, error } = await supabase
      .from('securities')
      .select('id, entity_id, ticker, name')
      .eq('market', 'stocks')
      .eq('locale', 'us')
      .eq('active', true)
      .not('entity_id', 'is', null)
      .order('ticker');
    if (error) throw new Error(error.message);
    securities = rows || [];
  }

  if (!apiKey) throw new Error('FMP_API_KEY not set');
  if (!securities.length) return { synced: 0, tradesInserted: 0, dryRun, message: 'No securities to sync' };

  let totalTrades = 0;
  const summary = { symbols: [], insidersCreated: 0, tradesInserted: 0, errors: [], restricted: false };

  for (let i = 0; i < securities.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const sec = securities[i];
    const symbol = sec.ticker;
    const companyEntityId = sec.entity_id;

    try {
      const result = await fetchFmpInsiderTrades(apiKey, symbol, limit);
      const trades = result.trades ?? (Array.isArray(result) ? result : []);
      if (result.restricted) summary.restricted = true;
      summary.symbols.push({ symbol, tradeCount: trades.length, restricted: !!result.restricted });

      for (const t of trades) {
        const reportingCik = t.reportingCik ?? t.reporting_cik ?? null;
        const reportingName = (t.reportingName ?? t.reporting_name ?? '').trim() || null;
        const personEntityId = await getOrCreatePersonEntity(supabase, reportingCik, reportingName);
        if (!personEntityId) continue;

        const typeOfOwner = t.typeOfOwner ?? t.type_of_owner ?? '';
        const role = mapTypeOfOwnerToRole(typeOfOwner);
        const nameParts = parseReportingName(reportingName);
        const personCik = t.personCik ?? t.person_cik ?? null;
        const insiderId = await getOrCreateInsider(
          supabase,
          companyEntityId,
          personEntityId,
          role,
          typeOfOwner || null,
          reportingCik,
          nameParts,
          personCik
        );
        if (!insiderId) continue;

        const acqDisp = (t.acquisitionOrDisposition ?? t.acquisition_or_disposition ?? '').toString().trim().toUpperCase();
        if (acqDisp !== 'A' && acqDisp !== 'D') continue;
        const transactionType = mapAcquisitionDispositionToType(acqDisp);
        const tradeDate = parseDate(t.transactionDate ?? t.transaction_date);
        const filingDate = parseDate(t.filingDate ?? t.filing_date);
        if (!tradeDate) continue;

        const shares = Number(t.securitiesTransacted ?? t.securities_transacted ?? 0);
        if (!Number.isFinite(shares) || shares < 0) continue;

        const priceUsd = t.price != null ? Number(t.price) : (t.pricePerShare ?? t.price_per_share) != null ? Number(t.pricePerShare ?? t.price_per_share) : null;
        let valueUsd = null;
        if (t.value != null && Number.isFinite(Number(t.value))) valueUsd = Number(t.value);
        else if ((t.valueUsd ?? t.value_usd) != null && Number.isFinite(Number(t.valueUsd ?? t.value_usd))) valueUsd = Number(t.valueUsd ?? t.value_usd);
        if (valueUsd == null && priceUsd != null && Number.isFinite(priceUsd) && Number.isFinite(shares)) {
          valueUsd = Math.round(shares * priceUsd * 100) / 100;
        }

        const existing = await supabase
          .from('insider_trades')
          .select('id')
          .eq('insider_id', insiderId)
          .eq('trade_date', tradeDate)
          .eq('shares', shares)
          .maybeSingle();
        if (existing?.id) continue;

        if (!dryRun) {
          const { error: insertErr } = await supabase.from('insider_trades').insert({
            insider_id: insiderId,
            transaction_type: transactionType,
            transaction_type_raw: t.transactionType ?? t.transaction_type ?? null,
            acquisition_or_disposition: acqDisp,
            direct_or_indirect: t.directOrIndirect ?? t.direct_or_indirect ?? null,
            shares,
            securities_owned_after: t.securitiesOwned != null ? Number(t.securitiesOwned) : null,
            price_usd: priceUsd,
            value_usd: valueUsd,
            security_name: t.securityName ?? t.security_name ?? null,
            trade_date: tradeDate,
            filing_date: filingDate,
            form_type: t.formType ?? t.form_type ?? null,
            filing_url: t.url ?? null,
            source: 'fmp',
            filing_id: t.url ?? null,
          });
          if (insertErr) {
            summary.errors.push({ symbol, reportingName, error: insertErr.message });
            continue;
          }
        }
        totalTrades++;
      }
      summary.tradesInserted = totalTrades;
    } catch (err) {
      summary.errors.push({ symbol, error: err.message });
    }
  }

  summary.tradesInserted = totalTrades;
  return { ...summary, dryRun };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (const a of args) {
    if (a.startsWith('--symbol=')) out.symbol = a.slice(9).trim();
    else if (a.startsWith('--limit=')) out.limit = parseInt(a.slice(8), 10);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--delay=')) out.delay = parseInt(a.slice(8), 10);
  }
  return out;
}

run(parseArgs())
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
