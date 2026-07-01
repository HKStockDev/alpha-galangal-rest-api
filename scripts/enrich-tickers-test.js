/**
 * Test enrichment for a fixed list of tickers: sync to securities/entities,
 * classify (GICS), assign tags, assign exposures. Uses FMP for company profile; prompts from DB.
 * Usage: node scripts/enrich-tickers-test.js
 */
require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const TICKERS = (process.env.ENRICH_TICKERS && process.env.ENRICH_TICKERS.trim())
  ? process.env.ENRICH_TICKERS.split(',').map((t) => t.trim()).filter(Boolean)
  : [
      'CSIQ', 'DNOW', 'GLOB', 'GTE', 'HLX', 'INN', 'JD', 'JKS', 'KMPR', 'KODK',
      'PAGP', 'PEB', 'RLJ', 'SGRY', 'SM', 'SVC',
    ];

const TAXONOMY_ID = process.env.TAXONOMY_ID || process.env.GICS_TAXONOMY_ID || 'da747382-8b83-4b0c-ad7c-234542e622c4';
const SKIP_FMP = process.env.SKIP_FMP === '1' || process.env.SKIP_FMP === 'true';

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
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

function fillTemplate(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), (v ?? '').toString());
  }
  return out;
}

async function runGemini(apiKey, promptVersion, templateVars) {
  const userText = fillTemplate(promptVersion.user_prompt_template || '', templateVars);
  const systemText = promptVersion.system_prompt || '';
  const model = (promptVersion.model_name || 'gemini-2.0-flash').startsWith('models/')
    ? promptVersion.model_name
    : `models/${promptVersion.model_name || 'gemini-2.0-flash'}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: promptVersion.temperature ?? 0.2,
      maxOutputTokens: promptVersion.max_output_tokens ?? 2048,
      responseMimeType: 'application/json',
    },
  };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data?.error?.message) || data?.message || res.statusText);
  const parts = (data?.candidates || [])[0]?.content?.parts || [];
  const text = parts.map((p) => p?.text || '').join('').trim();
  if (!text) throw new Error('Empty Gemini response');
  let raw = text;
  const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (codeBlock) raw = codeBlock[1].trim();
  return JSON.parse(raw);
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }
  const projectRef = process.env.SUPABASE_PROJECT_ID || new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  const pg = new Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await pg.connect();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );

  async function loadActivePromptVersion(promptKey) {
    const { data: prompt, error: pErr } = await supabase
      .from('prompts')
      .select('active_prompt_version_id')
      .eq('key', promptKey)
      .single();
    if (pErr || !prompt?.active_prompt_version_id) return null;
    const { data: pv, error: pvErr } = await supabase
      .from('prompt_versions')
      .select('system_prompt, user_prompt_template, model_name, temperature, max_output_tokens')
      .eq('id', prompt.active_prompt_version_id)
      .single();
    if (pvErr || !pv) return null;
    return pv;
  }

  async function getOrCreateEntity(pg, securityId, ticker, name) {
    const sec = await pg.query('SELECT entity_id FROM securities WHERE id = $1', [securityId]);
    if (sec.rows[0]?.entity_id) return sec.rows[0].entity_id;
    const byKey = await pg.query(
      "SELECT id FROM entities WHERE entity_type = 'security' AND key = $1",
      [ticker]
    );
    if (byKey.rows[0]?.id) {
      await pg.query('UPDATE securities SET entity_id = $1 WHERE id = $2', [byKey.rows[0].id, securityId]);
      return byKey.rows[0].id;
    }
    const ins = await pg.query(
      "INSERT INTO entities (entity_type, key, name) VALUES ('security', $1, $2) RETURNING id",
      [ticker, name || ticker]
    );
    const entityId = ins.rows[0]?.id;
    if (entityId) await pg.query('UPDATE securities SET entity_id = $1 WHERE id = $2', [entityId, securityId]);
    return entityId;
  }

  const results = [];
  const delayMs = 1500;
  for (let i = 0; i < TICKERS.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const ticker = TICKERS[i];
    const t = ticker.trim().toUpperCase();
    console.log(`\n--- ${t} ---`);
    try {
      let details;
      let profileForSync = null;
      if (SKIP_FMP) {
        const existing = await pg.query(
          `SELECT id, ticker, name, description, sic_code, sic_description, homepage_url, primary_exchange FROM securities WHERE market = 'stocks' AND locale = 'us' AND ticker = $1`,
          [t]
        );
        if (!existing.rows[0]) {
          console.log(`  Skip: not in securities (use without SKIP_FMP to fetch from FMP)`);
          results.push({ ticker: t, error: 'Not in securities' });
          continue;
        }
        const r = existing.rows[0];
        details = { ticker: r.ticker, name: r.name, description: r.description || '', sic_code: r.sic_code ?? '', sic_description: r.sic_description ?? '', homepage_url: r.homepage_url ?? '', primary_exchange: r.primary_exchange ?? '' };
      } else {
        const profile = await fetchProfileFromFmp(t);
        if (!profile) {
          console.log(`  Skip: no FMP profile`);
          results.push({ ticker: t, error: 'No FMP profile' });
          continue;
        }
        profileForSync = profile;
        details = {
          ticker: profile.symbol ?? t,
          name: profile.companyName ?? t,
          description: profile.description ?? '',
          sic_code: profile.cik ?? '',
          sic_description: '',
          homepage_url: profile.website ?? '',
          primary_exchange: profile.exchangeShortName ?? profile.exchange ?? '',
        };
      }
      let securityId;
      if (SKIP_FMP) {
        const existing = await pg.query(`SELECT id FROM securities WHERE market = 'stocks' AND locale = 'us' AND ticker = $1`, [t]);
        securityId = existing.rows[0]?.id;
      }
      if (!securityId && profileForSync) {
        const row = mapFmpProfileToSecuritiesRow(profileForSync);
        const ins = await pg.query(
          `INSERT INTO securities (ticker, market, locale, name, ticker_root, ticker_suffix, cik, composite_figi, share_class_figi, type_code, type_description, description, homepage_url, phone_number, total_employees, list_date, primary_exchange, currency_name, sic_code, sic_description, market_cap, share_class_shares_outstanding, weighted_shares_outstanding, round_lot, active, delisted_utc)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
           ON CONFLICT (market, locale, ticker) DO UPDATE SET
             name=EXCLUDED.name, description=EXCLUDED.description, homepage_url=EXCLUDED.homepage_url, sic_code=EXCLUDED.sic_code, sic_description=EXCLUDED.sic_description, updated_at=now()
           RETURNING id`,
          [row.ticker, row.market, row.locale, row.name, row.ticker_root, row.ticker_suffix, row.cik, row.composite_figi, row.share_class_figi, row.type_code, row.type_description, row.description, row.homepage_url, row.phone_number, row.total_employees, row.list_date, row.primary_exchange, row.currency_name, row.sic_code, row.sic_description, row.market_cap, row.share_class_shares_outstanding, row.weighted_shares_outstanding, row.round_lot, row.active, row.delisted_utc]
        );
        securityId = ins.rows[0]?.id;
      }
      if (!securityId) {
        results.push({ ticker: t, error: 'Insert failed or not in DB' });
        continue;
      }
      const entityId = await getOrCreateEntity(pg, securityId, t, details.name || t);
      console.log(`  security_id=${securityId}, entity_id=${entityId}`);

      const classPrompt = await loadActivePromptVersion('security_classification');
      if (classPrompt) {
        const nodesRes = await pg.query(
          `SELECT node_id, code, title FROM taxonomy_nodes WHERE taxonomy_id = $1 AND level = 'sub_industry' ORDER BY code`,
          [TAXONOMY_ID]
        );
        const subList = nodesRes.rows.map((n) => `${n.code}: ${n.title}`).join('\n');
        const codeToNode = Object.fromEntries(nodesRes.rows.map((n) => [String(n.code).trim(), n]));
        const result = await runGemini(apiKey, classPrompt, {
          ticker: details.ticker ?? '',
          name: details.name ?? '',
          sic_code: details.sic_code ?? 'N/A',
          sic_description: details.sic_description ?? 'N/A',
          description: (details.description ?? '').slice(0, 1500),
          homepage_url: details.homepage_url ?? 'N/A',
          primary_exchange: details.primary_exchange ?? 'N/A',
          sub_industries_list: subList,
        });
        const gicsCode = String(result.gics_code ?? '').trim();
        const node = codeToNode[gicsCode];
        if (node) {
          let confidence = Number(result.confidence);
          if (Number.isNaN(confidence) || confidence < 0) confidence = 0.5;
          if (confidence > 1) confidence = 1;
          const asOfDate = new Date().toISOString().slice(0, 10);
          const notes = `${t} -> GICS ${gicsCode}. ${result.reasoning || ''}`.slice(0, 500);
          await pg.query(
            `INSERT INTO security_classifications (security_id, taxonomy_id, taxonomy_node_id, source, confidence, as_of_date, notes)
             VALUES ($1, $2, $3, 'llm_assisted', $4, $5, $6)
             ON CONFLICT (security_id, taxonomy_id, taxonomy_node_id, as_of_date) DO UPDATE SET confidence = EXCLUDED.confidence, notes = EXCLUDED.notes, updated_at = now()`,
            [securityId, TAXONOMY_ID, node.node_id, Math.round(confidence * 10000) / 10000, asOfDate, notes]
          );
          console.log(`  classification: ${gicsCode} (${node.title})`);
        } else {
          console.log(`  classification: skipped (unknown gics_code ${gicsCode})`);
        }
      }

      const tagPrompt = await loadActivePromptVersion('security_tagging');
      if (tagPrompt) {
        const { data: tags } = await supabase.from('tags').select('tag_id, slug, name, group').eq('is_active', true).eq('is_llm_assignable', true);
        const tagsList = (tags || []).map((x) => ({ slug: x.slug, name: x.name, group: x.group }));
        const slugToId = Object.fromEntries((tags || []).map((x) => [x.slug, x.tag_id]));
        const result = await runGemini(apiKey, tagPrompt, {
          ticker: t,
          name: details.name ?? '',
          description: (details.description ?? '').slice(0, 2000),
          tags_json: JSON.stringify(tagsList, null, 2),
        });
        const assignments = result.assignments || [];
        const asOfDate = new Date().toISOString().slice(0, 10);
        let tagCount = 0;
        for (const a of assignments) {
          const tagId = slugToId[a.tag_slug];
          if (!tagId) continue;
          const confidence = Math.min(1, Math.max(0, Number(a.confidence) || 0.5));
          await pg.query(
            `INSERT INTO security_tags (security_id, tag_id, source, confidence, evidence, as_of_date)
             VALUES ($1, $2, 'llm', $3, $4, $5)
             ON CONFLICT (security_id, tag_id, as_of_date) DO UPDATE SET confidence = EXCLUDED.confidence, evidence = EXCLUDED.evidence, updated_at = now()`,
            [securityId, tagId, confidence, (a.evidence || '').slice(0, 1000) || null, asOfDate]
          );
          tagCount++;
        }
        console.log(`  tags: ${tagCount}`);
      }

      const expPrompt = await loadActivePromptVersion('security_exposures');
      if (expPrompt) {
        const { data: exposures } = await supabase.from('exposures').select('exposure_id, slug, name, category').eq('is_active', true);
        const expList = (exposures || []).map((x) => ({ slug: x.slug, name: x.name, category: x.category }));
        const slugToId = Object.fromEntries((exposures || []).map((x) => [x.slug, x.exposure_id]));
        const result = await runGemini(apiKey, expPrompt, {
          ticker: t,
          name: details.name ?? '',
          description: (details.description ?? '').slice(0, 2000),
          exposures_json: JSON.stringify(expList, null, 2),
        });
        const assignments = result.assignments || [];
        const validDir = ['beneficiary', 'dependent', 'supplier', 'customer'];
        const asOfDate = new Date().toISOString().slice(0, 10);
        let expCount = 0;
        for (const a of assignments) {
          const exposureId = slugToId[a.exposure_slug];
          if (!exposureId) continue;
          const direction = validDir.includes(a.direction) ? a.direction : 'beneficiary';
          const strength = Math.min(1, Math.max(0, Number(a.strength) ?? 0.5));
          const confidence = Math.min(1, Math.max(0, Number(a.confidence) ?? 0.5));
          await pg.query(
            `INSERT INTO security_exposures (security_id, exposure_id, direction, strength, source, confidence, evidence, as_of_date)
             VALUES ($1, $2, $3, $4, 'llm', $5, $6, $7)
             ON CONFLICT (security_id, exposure_id, direction, as_of_date) DO UPDATE SET strength = EXCLUDED.strength, confidence = EXCLUDED.confidence, evidence = EXCLUDED.evidence, updated_at = now()`,
            [securityId, exposureId, direction, strength, confidence, (a.evidence || '').slice(0, 1000) || null, asOfDate]
          );
          expCount++;
        }
        console.log(`  exposures: ${expCount}`);
      }

      results.push({ ticker: t, security_id: securityId, entity_id: entityId });
    } catch (err) {
      console.log(`  Error: ${err.message}`);
      results.push({ ticker: t, error: err.message });
    }
  }

  await pg.end();
  console.log('\n--- Summary ---');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
