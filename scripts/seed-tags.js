/**
 * Seeds the tags table from security_tags_dictionary_v1.json.
 * Usage: node scripts/seed-tags.js
 */
require('dotenv').config({ path: '.env.development' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const raw = fs.readFileSync(path.join('/Users/alexp/Downloads', 'security_tags_dictionary_v1.json'), 'utf8');
  const data = JSON.parse(raw);
  const tagRows = data.tags || [];

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

  let inserted = 0;
  for (const t of tagRows) {
    const name = (t.name ?? '').trim();
    const slug = (t.slug ?? '').trim();
    const group = (t.group ?? '').trim();
    if (!name || !slug || !group) continue;
    const isLlmAssignable = t.is_llm_assignable !== false;
    await client.query(
      `INSERT INTO tags (name, slug, "group", is_active, is_llm_assignable)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         "group" = EXCLUDED."group",
         is_llm_assignable = EXCLUDED.is_llm_assignable,
         updated_at = now()`,
      [name, slug, group, isLlmAssignable]
    );
    inserted++;
  }
  console.log('Done. Tags seeded:', inserted);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
