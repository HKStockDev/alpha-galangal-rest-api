/**
 * Apply a single file from supabase/migrations (same DB connection as scripts/migrate.js).
 * Usage: node scripts/apply-migration.cjs 20260401234958_seed_political_score_formula.sql
 */
const fs = require('fs');
const path = require('path');
const { createPgClient } = require('./pg-client.cjs');
const {
  isMigrationRegistryComplete,
  recordMigration,
} = require('./supabase-migration-registry.cjs');

const root = path.join(__dirname, '..');

const file = process.argv[2];
if (!file || !file.endsWith('.sql')) {
  console.error('Usage: node scripts/apply-migration.cjs <filename.sql>');
  process.exit(1);
}

async function run() {
  const client = createPgClient();

  const sqlPath = path.join(__dirname, '../supabase/migrations', file);
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await client.connect();
  try {
    const registryComplete = await isMigrationRegistryComplete(client, file);
    if (!registryComplete) {
      await client.query(sql);
      console.log(`Applied SQL: ${file}`);
    } else {
      console.log(`SQL skipped (already applied with complete registry): ${file}`);
    }

    const recorded = await recordMigration(client, file, sql);
    if (recorded.inserted) {
      console.log(
        `Registered in supabase_migrations.schema_migrations (version ${recorded.version}, name ${recorded.name})`,
      );
    } else if (registryComplete) {
      console.log(`Already registered (version ${recorded.version}, name ${recorded.name})`);
    } else {
      console.log(
        `Registry repaired for version ${recorded.version}; dashboard should show "${recorded.name}"`,
      );
    }
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
