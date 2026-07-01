const fs = require('fs');
const path = require('path');
const { createPgClient } = require('./pg-client.cjs');

const migrationsDir = path.join(__dirname, '../supabase/migrations');

async function run() {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = createPgClient();
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT name FROM supabase_migrations.schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.name));
    const missing = files
      .map((f) => f.replace(/\.sql$/, ''))
      .filter((name) => !applied.has(name));
    console.log('Local SQL files:', files.length);
    console.log('Registered in schema_migrations:', applied.size);
    console.log('Missing from registry (' + missing.length + '):');
    for (const name of missing) console.log('  -', name);
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
