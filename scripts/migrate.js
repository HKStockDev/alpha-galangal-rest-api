const fs = require('fs');
const path = require('path');
const { createPgClient } = require('./pg-client.cjs');

const root = path.join(__dirname, '..');

const migrationsDir = path.join(root, 'supabase/migrations');

async function run() {
  const client = createPgClient();

  try {
    await client.connect();
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Running ${file}...`);
      await client.query(sql);
      console.log(`  ✓ ${file}`);
    }
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
