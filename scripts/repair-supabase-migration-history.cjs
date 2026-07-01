/**
 * Backfill supabase_migrations.schema_migrations for SQL already applied via pg client.
 *
 * Usage:
 *   node scripts/repair-supabase-migration-history.cjs
 *   node scripts/repair-supabase-migration-history.cjs 20260529173349_create_credit_packs.sql ...
 */
const path = require('path');
const { createPgClient } = require('./pg-client.cjs');
const { repairMigrations } = require('./supabase-migration-registry.cjs');

const migrationsDir = path.join(__dirname, '../supabase/migrations');

const DEFAULT_FILES = [
  '20260603120000_con105_ai_tools_schemas_and_discovery.sql',
  '20260529173349_create_credit_packs.sql',
  '20260529173359_create_organization_credit_wallets.sql',
  '20260529173409_create_organization_credit_lots_and_transactions.sql',
  '20260529173419_create_ai_capability_credit_costs_and_credit_policy.sql',
  '20260529180000_credits_phase0_monthly_base_and_consume_rpc.sql',
];

async function run() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;
  const client = createPgClient();
  await client.connect();

  try {
    const results = await repairMigrations(client, files, migrationsDir);
    for (const r of results) {
      console.log(`${r.status.padEnd(20)} ${r.name}`);
    }
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
