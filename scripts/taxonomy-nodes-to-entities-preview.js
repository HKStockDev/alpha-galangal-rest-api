/**
 * Builds entity rows from all taxonomy_nodes (with taxonomy name), outputs a preview.
 * Optionally insert with: node scripts/taxonomy-nodes-to-entities-preview.js --insert
 *
 * Entity fields:
 *   entity_type: 'taxonomy_node'
 *   key: meaningful slug e.g. "gics:sector:10", "gics:sub_industry:internet_services_infrastructure"
 *   name: "{Taxonomy Name} – {level}: {Node Title}"
 */
require('dotenv').config({ path: '.env.development' });
const { Client } = require('pg');

const PREVIEW_ROWS = 25;

function slugify(s) {
  if (s == null || s === '') return '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'unnamed';
}

async function main() {
  const doInsert = process.argv.includes('--insert');
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

  const { rows: nodes } = await client.query(
    `SELECT n.node_id, n.taxonomy_id, n.level, n.code,
            n.title AS node_title,
            t.name AS taxonomy_name
     FROM taxonomy_nodes n
     JOIN taxonomies t ON t.taxonomy_id = n.taxonomy_id
     ORDER BY t.name, n.level, n.code NULLS LAST, n.node_id`
  );

  const levelLabel = (level) => {
    const m = { sector: 'sector', industry_group: 'industry group', industry: 'industry', sub_industry: 'sub-industry' };
    return m[level] || level;
  };

  const taxonomySlug = (name) => slugify(name) || 'taxonomy';
  const keyPart = (n) => (n.code != null && String(n.code).trim() !== '' ? String(n.code).trim() : slugify(n.node_title));

  const seenKeys = new Set();
  const entityRows = nodes.map((n) => {
    const taxSlug = taxonomySlug(n.taxonomy_name);
    const part = keyPart(n);
    let key = `${taxSlug}:${n.level}:${part}`;
    if (seenKeys.has(key)) {
      key = `${key}_${String(n.node_id).replace(/-/g, '').slice(0, 8)}`;
    }
    seenKeys.add(key);
    return {
      entity_type: 'taxonomy_node',
      key,
      name: `${n.taxonomy_name} – ${levelLabel(n.level)}: ${n.node_title || '(unnamed)'}`,
      _node_id: n.node_id,
      _taxonomy_name: n.taxonomy_name,
      _level: n.level,
      _code: n.code,
      _node_title: n.node_title,
    };
  });

  console.log('\n=== PREVIEW: entities from taxonomy_nodes ===\n');
  console.log('entities table columns used: entity_type, key, name (created_at default)\n');
  console.log(`Total rows to insert: ${entityRows.length}\n`);
  console.log('First', PREVIEW_ROWS, 'rows (key = taxonomy:level:code_or_slug, name = display name):\n');

  const preview = entityRows.slice(0, PREVIEW_ROWS).map((e) => ({
    entity_type: e.entity_type,
    key: e.key,
    name: e.name,
  }));
  console.log(JSON.stringify(preview, null, 2));

  console.log('\n--- Sample by level ---');
  const byLevel = {};
  entityRows.forEach((e) => {
    byLevel[e._level] = (byLevel[e._level] || 0) + 1;
  });
  console.log(byLevel);

  if (doInsert && entityRows.length > 0) {
    console.log('\n--- Inserting into entities ---');
    let inserted = 0;
    for (const e of entityRows) {
      await client.query(
        `INSERT INTO entities (entity_type, key, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name`,
        [e.entity_type, e.key, e.name]
      );
      inserted++;
    }
    console.log('Done. Inserted/updated:', inserted);
  } else if (!doInsert) {
    console.log('\nTo insert into DB, run: node scripts/taxonomy-nodes-to-entities-preview.js --insert');
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
