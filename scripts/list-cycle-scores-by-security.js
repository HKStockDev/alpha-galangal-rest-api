/**
 * List each security's GICS classification (sector, industry, sub_industry) and
 * cycle scores (6m, 12m, 24m) for each level. Outputs a table to the console.
 * Usage: node scripts/list-cycle-scores-by-security.js
 */
require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
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

  const taxonomy_nodes = await pg.query(`
    SELECT node_id, level, title, parent_node_id FROM taxonomy_nodes
  `);
  const nodeMap = new Map((taxonomy_nodes.rows || []).map((n) => [n.node_id, n]));

  const secClass = await pg.query(`
    SELECT s.ticker, sc.taxonomy_node_id AS sub_id
    FROM securities s
    JOIN security_classifications sc ON sc.security_id = s.id
    ORDER BY s.ticker
  `);

  function getAncestors(subNodeId) {
    const result = { sector: null, industry: null, sub_industry: null };
    let node = nodeMap.get(subNodeId);
    if (!node) return result;
    result.sub_industry = node.title;
    const byLevel = { sector: null, industry: null, sub_industry: null };
    byLevel[node.level] = { node_id: node.node_id, title: node.title };
    while (node && node.parent_node_id) {
      node = nodeMap.get(node.parent_node_id);
      if (node) byLevel[node.level] = { node_id: node.node_id, title: node.title };
    }
    result.sector = byLevel.sector?.title ?? null;
    result.industry = byLevel.industry?.title ?? null;
    return result;
  }

  const entityByNode = await pg.query(`
    SELECT e.id AS entity_id, e.taxonomy_node_id, e.entity_type
    FROM entities e
    WHERE e.taxonomy_node_id IS NOT NULL AND e.entity_type IN ('sector', 'industry', 'sub_industry')
  `);
  const entityMap = new Map((entityByNode.rows || []).map((r) => [r.taxonomy_node_id, r.entity_id]));

  const factorIds = await pg.query(`SELECT id, key FROM factors WHERE key IN ('sector_cycle_score', 'industry_cycle_score', 'sub_industry_cycle_score')`);
  const factorKeyToId = Object.fromEntries((factorIds.rows || []).map((r) => [r.key, r.id]));

  const values = await pg.query(`
    SELECT efv.entity_id, f.key AS factor_key, efv.period_key, efv.value_num
    FROM entity_factor_values efv
    JOIN factors f ON f.id = efv.factor_id
    WHERE efv.model_version = 'v1' AND f.key IN ('sector_cycle_score', 'industry_cycle_score', 'sub_industry_cycle_score')
  `);
  const scoreMap = new Map();
  for (const v of values.rows || []) {
    scoreMap.set(`${v.entity_id}|${v.factor_key}|${v.period_key}`, v.value_num);
  }

  const levelToFactor = { sector: 'sector_cycle_score', industry: 'industry_cycle_score', sub_industry: 'sub_industry_cycle_score' };
  const tickers = [...new Set((secClass.rows || []).map((r) => r.ticker))].sort();
  const data = [];
  for (const ticker of tickers) {
    const row = secClass.rows.find((r) => r.ticker === ticker);
    if (!row?.sub_id) continue;
    const names = getAncestors(row.sub_id);
    const nodeIds = {};
    let n = nodeMap.get(row.sub_id);
    while (n) {
      if (n.level in levelToFactor) nodeIds[n.level] = n.node_id;
      n = n.parent_node_id ? nodeMap.get(n.parent_node_id) : null;
    }
    const out = {
      ticker,
      sector: names.sector ?? '—',
      industry: names.industry ?? '—',
      sub_industry: names.sub_industry ?? '—',
      sector_6m: null,
      sector_12m: null,
      sector_24m: null,
      industry_6m: null,
      industry_12m: null,
      industry_24m: null,
      sub_6m: null,
      sub_12m: null,
      sub_24m: null,
    };
    for (const level of ['sector', 'industry', 'sub_industry']) {
      const nodeId = nodeIds[level];
      const entityId = nodeId ? entityMap.get(nodeId) : null;
      const factorKey = levelToFactor[level];
      if (entityId) {
        for (const period of ['6m', '12m', '24m']) {
          const val = scoreMap.get(`${entityId}|${factorKey}|${period}`);
          out[`${level}_${period}`] = val != null ? val : '—';
        }
      }
    }
    data.push(out);
  }

  await pg.end();

  const fmt = (v, w) => String(v ?? '—').slice(0, w).padEnd(w);
  console.log('\n--- Cycle scores by security (1 = positive, 0 = neutral, -1 = negative) ---\n');
  console.log('| Ticker | Sector              | Industry             | Sub-Industry           | Sec 6m 12m 24m | Ind 6m 12m 24m | Sub 6m 12m 24m |');
  console.log('|--------|---------------------|----------------------|------------------------|----------------|----------------|----------------|');
  for (const r of data) {
    const ticker = fmt(r.ticker, 6);
    const sector = fmt(r.sector, 19);
    const industry = fmt(r.industry, 20);
    const sub = fmt(r.sub_industry, 22);
    const sScores = `${fmt(r.sector_6m, 2)}  ${fmt(r.sector_12m, 2)}  ${fmt(r.sector_24m, 2)}`;
    const iScores = `${fmt(r.industry_6m, 2)}  ${fmt(r.industry_12m, 2)}  ${fmt(r.industry_24m, 2)}`;
    const uScores = `${fmt(r.sub_industry_6m, 2)}  ${fmt(r.sub_industry_12m, 2)}  ${fmt(r.sub_industry_24m, 2)}`;
    console.log(`| ${ticker} | ${sector} | ${industry} | ${sub} | ${sScores} | ${iScores} | ${uScores} |`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
