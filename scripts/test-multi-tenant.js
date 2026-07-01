require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });

const { Client } = require('pg');

async function main() {
  const projectRef =
    process.env.SUPABASE_PROJECT_ID ||
    new URL(process.env.SUPABASE_URL).hostname.split('.')[0];

  const client = new Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const out = {};
  async function q(key, sql, params = []) {
    const res = await client.query(sql, params);
    out[key] = res.rows;
  }

  await q(
    'profiles_team',
    'select id, email from public.profiles where lower(email)=lower($1)',
    ['team@purrr.ai']
  );
  await q(
    'org_default',
    'select id, slug, organization_type, status from public.organizations where slug=$1',
    ['default-organization']
  );
  await q(
    'membership_default',
    `select organization_id, user_id, role, status
     from public.organization_memberships
     where organization_id = (select id from public.organizations where slug=$1)
     limit 5`,
    ['default-organization']
  );

  await q(
    'factors_null_org',
    'select count(*)::int as null_count from public.factors where organization_id is null'
  );
  await q(
    'formulas_null_org',
    'select count(*)::int as null_count from public.formulas where organization_id is null'
  );
  await q(
    'prompts_null_org',
    'select count(*)::int as null_count from public.prompts where organization_id is null'
  );
  await q(
    'prompt_versions_null_org',
    'select count(*)::int as null_count from public.prompt_versions where organization_id is null'
  );
  await q(
    'tags_null_org',
    'select count(*)::int as null_count from public.tags where organization_id is null'
  );
  await q(
    'signal_categories_null_org',
    'select count(*)::int as null_count from public.signal_categories where organization_id is null'
  );

  console.log(JSON.stringify(out, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

