require('dotenv').config({ path: '.env.development' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const TAXONOMY_ID = 'da747382-8b83-4b0c-ad7c-234542e622c4';
const LEVEL_ORDER = { sector: 0, industry_group: 1, industry: 2, sub_industry: 3 };
const BATCH = 100;

function parentCodeFor(row) {
  const code = row.node_code || row.code;
  if (!code) return null;
  if (row.level === 'sector') return null;
  if (row.level === 'industry_group') return code.slice(0, 2);
  if (row.level === 'industry') return code.slice(0, 4);
  if (row.level === 'sub_industry') return code.slice(0, 6);
  return null;
}

async function main() {
  const raw = fs.readFileSync(path.join('/Users/alexp/Downloads', 'gics_2025_taxonomy_nodes.json'), 'utf8');
  const rows = JSON.parse(raw);
  const taxonomyId = TAXONOMY_ID;

  const normalized = rows.map((r) => ({
    level: r.level,
    title: r.title || r.name,
    code: r.node_code || r.code,
    description: r.description ?? null,
    parent_code: parentCodeFor(r),
    sort_order: r.sort_order ?? null,
    is_active: r.is_active !== false,
  }));

  normalized.sort((a, b) => {
    const l = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (l !== 0) return l;
    return (a.sort_order ?? 9999) - (b.sort_order ?? 9999);
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
  const codeToId = {};

  const insertOne = async (row) => {
    const parentNodeId = row.parent_code ? codeToId[row.parent_code] : null;
    const res = await client.query(
      `INSERT INTO public.taxonomy_nodes (taxonomy_id, level, title, code, description, parent_node_id, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING node_id`,
      [
        taxonomyId,
        row.level,
        row.title,
        row.code,
        row.description,
        parentNodeId,
        row.sort_order,
        row.is_active,
      ]
    );
    const nodeId = res.rows[0].node_id;
    if (row.code) codeToId[row.code] = nodeId;
    return nodeId;
  };

  let inserted = 0;
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    for (const row of batch) {
      await insertOne(row);
      inserted++;
    }
    console.log('Inserted', inserted, '/', normalized.length);
  }

  console.log('Done. Total nodes:', inserted);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
