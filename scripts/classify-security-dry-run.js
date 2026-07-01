/**
 * Fetch ticker from FMP API, use Gemini to pick best GICS sub_industry,
 * optionally sync to securities and store in security_classifications.
 * Usage: node scripts/classify-security-dry-run.js <TICKER> [store]
 * Example: node scripts/classify-security-dry-run.js CRWV        (dry-run)
 *          node scripts/classify-security-dry-run.js CRWV store  (sync + insert)
 */
require('dotenv').config({ path: '.env.development' });
const { Client } = require('pg');

const TAXONOMY_ID = 'da747382-8b83-4b0c-ad7c-234542e622c4';
const GEMINI_MODEL = 'gemini-2.0-flash';

function mapFmpProfileToSecuritiesRow(r) {
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
    type_code: 'CS',
    type_description: null,
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
    share_class_shares_outstanding: null,
    weighted_shares_outstanding: null,
    round_lot: null,
    active: true,
    delisted_utc: null,
  };
}

async function fetchProfileFromFmp(symbol) {
  const apiKey = process.env.FMP_API_KEY;
  const baseUrl = (process.env.FMP_API_BASE_URL || 'https://financialmodelingprep.com').replace(/\/$/, '');
  if (!apiKey) throw new Error('FMP_API_KEY not set');
  const url = `${baseUrl}/stable/profile?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.['Error Message'] ?? res.statusText);
  if (!Array.isArray(data) || data.length === 0) throw new Error('No profile for ticker');
  return data[0];
}

function profileToTickerDetails(profile) {
  return {
    ticker: profile.symbol ?? '',
    name: profile.companyName ?? '',
    sic_code: profile.cik ?? 'N/A',
    sic_description: '',
    description: profile.description ?? '',
    homepage_url: profile.website ?? 'N/A',
    primary_exchange: profile.exchangeShortName ?? profile.exchange ?? 'N/A',
  };
}

async function callGeminiForClassification(apiKey, tickerDetails, subIndustriesList) {
  const systemPrompt = `You are a classifier that assigns a company to the best-matching GICS (Global Industry Classification Standard) sub-industry.
You are given company details: ticker, name, SIC code/description, company description, homepage, etc.
You are also given the full list of GICS sub_industries (code and title).
Respond with exactly one best-matching GICS sub_industry and a confidence between 0 and 1.
Respond only with valid JSON (no markdown):
{"gics_code":"<8-digit GICS code>","confidence":<0-1 number>,"reasoning":"<short explanation>"}
Use the company description and business (homepage, SIC) to choose; SIC is a hint but not binding.`;

  const userPrompt = `Company to classify:
- ticker: ${tickerDetails.ticker ?? ''}
- name: ${tickerDetails.name ?? ''}
- sic_code: ${tickerDetails.sic_code ?? 'N/A'}
- sic_description: ${tickerDetails.sic_description ?? 'N/A'}
- description: ${(tickerDetails.description ?? '').slice(0, 1500)}
- homepage_url: ${tickerDetails.homepage_url ?? 'N/A'}
- primary_exchange: ${tickerDetails.primary_exchange ?? 'N/A'}

GICS sub_industries (choose exactly one by its code):
${subIndustriesList}

Return JSON: {"gics_code":"...", "confidence": <0-1>, "reasoning":"..."}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? data?.message ?? res.statusText);
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text ?? '').join('').trim();
  if (!text) throw new Error('Empty Gemini response');
  let raw = text;
  const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (codeBlock) raw = codeBlock[1].trim();
  const parsed = JSON.parse(raw);
  const gicsCode = String(parsed.gics_code ?? '').trim();
  let confidence = Number(parsed.confidence);
  if (Number.isNaN(confidence) || confidence < 0) confidence = 0.5;
  if (confidence > 1) confidence = 1;
  return { gicsCode, confidence, reasoning: parsed.reasoning };
}

async function main() {
  const ticker = (process.argv[2] || 'CRWV').trim().toUpperCase();
  const doStore = process.argv[3] === 'store';
  if (!ticker) {
    console.error('Usage: node scripts/classify-security-dry-run.js <TICKER> [store]');
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set.');
    process.exit(1);
  }

  console.log(`\n--- Fetching ${ticker} from FMP API ---\n`);
  const profile = await fetchProfileFromFmp(ticker);
  const tickerDetails = profileToTickerDetails(profile);
  console.log('Ticker details:', {
    ticker: tickerDetails.ticker,
    name: tickerDetails.name,
    sic_code: tickerDetails.sic_code,
    sic_description: tickerDetails.sic_description,
    description: (tickerDetails.description ?? '').slice(0, 200) + (tickerDetails.description && tickerDetails.description.length > 200 ? '...' : ''),
    homepage_url: tickerDetails.homepage_url,
  });

  const projectRef = process.env.SUPABASE_PROJECT_ID || new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  const client = new Client({
    host: 'db.' + projectRef + '.supabase.co',
    port: 5432,
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  let securityId = null;
  if (doStore) {
    const row = mapFmpProfileToSecuritiesRow(profile);
    const ins = await client.query(
      `INSERT INTO securities (ticker, market, locale, name, ticker_root, ticker_suffix, cik, composite_figi, share_class_figi, type_code, type_description, description, homepage_url, phone_number, total_employees, list_date, primary_exchange, currency_name, sic_code, sic_description, market_cap, share_class_shares_outstanding, weighted_shares_outstanding, round_lot, active, delisted_utc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       ON CONFLICT (market, locale, ticker) DO UPDATE SET
         name=EXCLUDED.name, description=EXCLUDED.description, homepage_url=EXCLUDED.homepage_url, sic_code=EXCLUDED.sic_code, sic_description=EXCLUDED.sic_description, updated_at=now()
       RETURNING id`,
      [row.ticker, row.market, row.locale, row.name, row.ticker_root, row.ticker_suffix, row.cik, row.composite_figi, row.share_class_figi, row.type_code, row.type_description, row.description, row.homepage_url, row.phone_number, row.total_employees, row.list_date, row.primary_exchange, row.currency_name, row.sic_code, row.sic_description, row.market_cap, row.share_class_shares_outstanding, row.weighted_shares_outstanding, row.round_lot, row.active, row.delisted_utc]
    );
    securityId = ins.rows[0]?.id;
    console.log('Synced to securities, security_id:', securityId);

    const secRow = await client.query('SELECT entity_id FROM securities WHERE id = $1', [securityId]);
    let entityId = secRow.rows[0]?.entity_id;
    if (!entityId) {
      const byKey = await client.query(
        `SELECT id FROM entities WHERE entity_type = 'security' AND key = $1`,
        [ticker]
      );
      if (byKey.rows[0]?.id) {
        entityId = byKey.rows[0].id;
        await client.query('UPDATE securities SET entity_id = $1 WHERE id = $2', [entityId, securityId]);
      } else {
        const insEntity = await client.query(
          `INSERT INTO entities (entity_type, key, name) VALUES ('security', $1, $2) RETURNING id`,
          [ticker, tickerDetails.name || ticker]
        );
        entityId = insEntity.rows[0]?.id;
        if (entityId) await client.query('UPDATE securities SET entity_id = $1 WHERE id = $2', [entityId, securityId]);
      }
      console.log('Entity get-or-create, entity_id:', entityId);
    }
  }

  const subRes = await client.query(
    `SELECT node_id, code, title FROM taxonomy_nodes
     WHERE taxonomy_id = $1 AND level = 'sub_industry' ORDER BY code`,
    [TAXONOMY_ID]
  );
  const subIndustries = subRes.rows;
  const subIndustriesList = subIndustries.map((r) => `${r.code}: ${r.title}`).join('\n');
  const codeToNode = Object.fromEntries(subIndustries.map((r) => [String(r.code).trim(), r]));

  console.log('\n--- Asking Gemini for best GICS sub_industry ---\n');
  const { gicsCode, confidence, reasoning } = await callGeminiForClassification(
    apiKey,
    tickerDetails,
    subIndustriesList
  );
  const node = codeToNode[gicsCode];
  if (!node) {
    console.error(`Gemini returned unknown gics_code: "${gicsCode}". Valid codes are 8-digit GICS sub_industry codes.`);
    await client.end();
    process.exit(1);
  }
  console.log('Gemini result:', { gics_code: gicsCode, confidence, reasoning });
  console.log('Resolved to:', node.title, `(node_id: ${node.node_id})`);

  const asOfDate = new Date().toISOString().slice(0, 10);
  const confidenceRounded = Math.round(confidence * 10000) / 10000;
  const notes = `${ticker} -> GICS ${gicsCode} (${node.title}). ${reasoning || ''}`.slice(0, 500);

  if (doStore && securityId) {
    await client.query(
      `INSERT INTO security_classifications (security_id, taxonomy_id, taxonomy_node_id, source, confidence, as_of_date, notes)
       VALUES ($1, $2, $3, 'llm_assisted', $4, $5, $6)
       ON CONFLICT (security_id, taxonomy_id, taxonomy_node_id, as_of_date) DO UPDATE SET
         confidence = EXCLUDED.confidence, notes = EXCLUDED.notes, updated_at = now()`,
      [securityId, TAXONOMY_ID, node.node_id, confidenceRounded, asOfDate, notes]
    );
    console.log('\n--- Stored in security_classifications ---\n');
    console.log({ security_id: securityId, taxonomy_id: TAXONOMY_ID, taxonomy_node_id: node.node_id, source: 'llm_assisted', confidence: confidenceRounded, as_of_date: asOfDate });
  } else {
    const wouldBeRow = {
      security_id: securityId ?? '<would come from securities.id after sync>',
      taxonomy_id: TAXONOMY_ID,
      taxonomy_node_id: node.node_id,
      source: 'llm_assisted',
      confidence: confidenceRounded,
      as_of_date: asOfDate,
      notes,
    };
    console.log('\n--- Would-be security_classifications row (NOT stored) ---\n');
    console.log(JSON.stringify(wouldBeRow, null, 2));
    if (!doStore) console.log('\nTo persist: node scripts/classify-security-dry-run.js <TICKER> store\n');
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
