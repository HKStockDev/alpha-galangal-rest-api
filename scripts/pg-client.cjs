const { Client } = require('pg');
const path = require('path');

function loadEnv() {
  const root = path.join(__dirname, '..');
  require('dotenv').config({ path: path.join(root, '.env.development') });
  require('dotenv').config({ path: path.join(root, '.env'), override: true });
}

function createPgClient() {
  loadEnv();

  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (dbUrl && /^postgres/i.test(String(dbUrl).trim())) {
    const u = String(dbUrl).trim();
    const isLocal =
      u.includes('localhost') || u.includes('127.0.0.1') || u.includes('0.0.0.0');
    return new Client({
      connectionString: u,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
  }

  const projectRef =
    process.env.SUPABASE_PROJECT_ID ||
    new URL(process.env.SUPABASE_URL || 'https://x.supabase.co').hostname.split('.')[0];

  const poolerRegion = process.env.SUPABASE_POOLER_REGION?.trim();
  if (poolerRegion) {
    return new Client({
      host: `aws-0-${poolerRegion}.pooler.supabase.com`,
      port: 5432,
      user: `postgres.${projectRef}`,
      password: process.env.POSTGRES_PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
    });
  }

  return new Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
}

module.exports = { createPgClient, loadEnv };
