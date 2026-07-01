/**
 * For taxonomy nodes (sector, industry, sub_industry) that appear in current securities'
 * classifications, call LLM prompts to get 6m/12m/24m cycle scores (1,0,-1) and write to entity_factor_values.
 * Then output all cycle values as a table.
 * Usage: node scripts/seed-cycle-scores-for-securities.js
 */
require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const DELAY_MS = 1500;

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
      maxOutputTokens: promptVersion.max_output_tokens ?? 256,
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

  const subIndustryNodeIds = await pg.query(
    `SELECT DISTINCT taxonomy_node_id FROM security_classifications WHERE taxonomy_node_id IS NOT NULL`
  );
  const leafIds = (subIndustryNodeIds.rows || []).map((r) => r.taxonomy_node_id);
  if (leafIds.length === 0) {
    console.log('No security classifications found. Run security enrichment first.');
    await pg.end();
    return;
  }

  const anc = await pg.query(
    `WITH RECURSIVE anc AS (
      SELECT node_id, level, parent_node_id, 1 AS depth
      FROM taxonomy_nodes
      WHERE node_id = ANY($1::uuid[])
      UNION ALL
      SELECT n.node_id, n.level, n.parent_node_id, a.depth + 1
      FROM taxonomy_nodes n
      JOIN anc a ON n.node_id = a.parent_node_id
    )
    SELECT DISTINCT node_id, level FROM anc WHERE level IN ('sector', 'industry', 'sub_industry')`,
    [leafIds]
  );
  const nodeIds = (anc.rows || []).map((r) => r.node_id);

  const entities = await pg.query(
    `SELECT e.id AS entity_id, e.entity_type AS level, e.taxonomy_node_id, n.title AS name, n.code, n.description
     FROM entities e
     JOIN taxonomy_nodes n ON n.node_id = e.taxonomy_node_id
     WHERE e.taxonomy_node_id = ANY($1::uuid[])
     ORDER BY e.entity_type, n.title`,
    [nodeIds]
  );
  const entityRows = entities.rows || [];
  const factorIds = await pg.query(
    `SELECT key, id AS factor_id FROM factors WHERE key IN ('sector_cycle_score', 'industry_cycle_score', 'sub_industry_cycle_score')`
  );
  const keyToFactorId = Object.fromEntries((factorIds.rows || []).map((r) => [r.key, r.factor_id]));

  const promptKeyByLevel = {
    sector: 'sector_cycle_score',
    industry: 'industry_cycle_score',
    sub_industry: 'sub_industry_cycle_score',
  };

  console.log(`Seeding cycle scores for ${entityRows.length} taxonomy nodes (sector/industry/sub_industry)...\n`);
  for (let i = 0; i < entityRows.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
    const row = entityRows[i];
    const promptKey = promptKeyByLevel[row.level];
    if (!promptKey) continue;
    const factorId = keyToFactorId[promptKey];
    if (!factorId) continue;
    const name = row.name || row.code || row.entity_id;
    console.log(`[${i + 1}/${entityRows.length}] ${row.level}: ${name}`);
    try {
      const promptVersion = await loadActivePromptVersion(promptKey);
      if (!promptVersion) {
        console.log('  skip: no prompt');
        continue;
      }
      const result = await runGemini(apiKey, promptVersion, {
        level: row.level,
        name: name,
        code: row.code ?? '',
        description: (row.description || '').slice(0, 500),
      });
      const v6 = result['6m'] != null ? Number(result['6m']) : 0;
      const v12 = result['12m'] != null ? Number(result['12m']) : 0;
      const v24 = result['24m'] != null ? Number(result['24m']) : 0;
      for (const { period_key, period_months, value } of [
        { period_key: '6m', period_months: 6, value: v6 },
        { period_key: '12m', period_months: 12, value: v12 },
        { period_key: '24m', period_months: 24, value: v24 },
      ]) {
        await pg.query(
          `INSERT INTO entity_factor_values (entity_id, factor_id, model_version, period_key, period_months, value_num, source, ingested_at)
           VALUES ($1, $2, 'v1', $3, $4, $5, 'llm', now())
           ON CONFLICT (entity_id, factor_id, model_version, period_key) DO UPDATE SET value_num = EXCLUDED.value_num, source = EXCLUDED.source, ingested_at = now(), updated_at = now()`,
          [row.entity_id, factorId, period_key, period_months, value]
        );
      }
      console.log(`  6m=${v6} 12m=${v12} 24m=${v24}`);
    } catch (err) {
      console.log(`  error: ${err.message}`);
    }
  }

  const table = await pg.query(
    `SELECT e.entity_type AS level, e.key AS entity_key, COALESCE(n.title, e.name) AS name, f.key AS factor, efv.period_key, efv.value_num
     FROM entity_factor_values efv
     JOIN entities e ON e.id = efv.entity_id
     JOIN factors f ON f.id = efv.factor_id
     LEFT JOIN taxonomy_nodes n ON n.node_id = e.taxonomy_node_id
     WHERE f.key IN ('sector_cycle_score', 'industry_cycle_score', 'sub_industry_cycle_score')
       AND efv.model_version = 'v1'
     ORDER BY e.entity_type, COALESCE(n.title, e.name), f.key, efv.period_key`
  );

  await pg.end();

  const rows = table.rows || [];
  if (rows.length === 0) {
    console.log('\nNo cycle values to display.');
    return;
  }

  const byLevelName = {};
  for (const r of rows) {
    const k = `${r.level}|${r.name || r.entity_key}`;
    if (!byLevelName[k]) byLevelName[k] = { level: r.level, name: r.name || r.entity_key, factor: r.factor, '6m': null, '12m': null, '24m': null };
    byLevelName[k][r.period_key] = r.value_num;
  }
  const flat = Object.values(byLevelName).sort((a, b) => {
    const l = a.level.localeCompare(b.level);
    if (l !== 0) return l;
    return (a.name || '').localeCompare(b.name || '');
  });

  console.log('\n--- Cycle scores (1 = positive, 0 = neutral, -1 = negative) ---\n');
  console.log('| Level        | Name                    | Factor                  | 6m  | 12m | 24m |');
  console.log('|--------------|-------------------------|-------------------------|-----|-----|-----|');
  for (const r of flat) {
    const level = (r.level || '').padEnd(12);
    const name = (r.name || '').slice(0, 23).padEnd(23);
    const factor = (r.factor || '').slice(0, 23).padEnd(23);
    const v6 = r['6m'] != null ? String(r['6m']).padStart(3) : ' - ';
    const v12 = r['12m'] != null ? String(r['12m']).padStart(3) : ' - ';
    const v24 = r['24m'] != null ? String(r['24m']).padStart(3) : ' - ';
    console.log(`| ${level} | ${name} | ${factor} | ${v6} | ${v12} | ${v24} |`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
