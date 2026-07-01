/**
 * Verifies entity_factor_values_ts is writable without persisting data.
 * Runs in a transaction and rolls back so no rows are stored.
 * Usage: node scripts/test-entity-factor-values-ts.js
 */
require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const projectRef = process.env.SUPABASE_PROJECT_ID || new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  const client = new Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query('BEGIN');
  try {
    const entity = await client.query(
      `SELECT id FROM entities WHERE entity_type = 'sector' AND taxonomy_node_id IS NOT NULL LIMIT 1`
    );
    const factor = await client.query(
      `SELECT id FROM factors WHERE key = 'sector_cycle_score' LIMIT 1`
    );
    if (!entity.rows[0]?.id || !factor.rows[0]?.id) {
      console.log('Skip: no sector entity or sector_cycle_score factor found');
      await client.query('ROLLBACK');
      await client.end();
      return;
    }
    const asOf = new Date().toISOString().slice(0, 10);
    await client.query(
      `INSERT INTO entity_factor_values_ts
       (entity_id, factor_id, value_num, period_key, period_months, end_date, model_version, as_of_date, source, ingested_at)
       VALUES ($1, $2, 0, '6m', 6, $3::date, 'v1', $3::date, 'test', now())`,
      [entity.rows[0].id, factor.rows[0].id, asOf]
    );
    const count = await client.query(
      `SELECT 1 FROM entity_factor_values_ts WHERE entity_id = $1 AND factor_id = $2 AND source = 'test'`,
      [entity.rows[0].id, factor.rows[0].id]
    );
    if (count.rows.length === 0) throw new Error('Insert did not find test row');
    console.log('entity_factor_values_ts: insert and read OK (rollback so nothing stored)');
  } finally {
    await client.query('ROLLBACK');
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
