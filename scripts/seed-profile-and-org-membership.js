/**
 * Create profile and org_admin membership for team@purrr.ai.
 * Run after the user exists in Supabase Auth (Dashboard → Authentication → Add user).
 *
 * Usage: node scripts/seed-profile-and-org-membership.js
 * Optional: SEED_EMAIL=other@example.com node scripts/seed-profile-and-org-membership.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Client } = require('pg');

const EMAIL = (process.env.SEED_EMAIL || 'anpolchert@gmail.com').trim().toLowerCase();
const FULL_NAME = process.env.SEED_FULL_NAME || 'Initial Admin';
const ORG_SLUG = process.env.SEED_ORG_SLUG || 'default-organization';
const ORG_NAME = process.env.SEED_ORG_NAME || 'Default Organization';
const ORG_TYPE = process.env.SEED_ORG_TYPE || 'research_firm';

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

  const userRes = await client.query(
    'select id from auth.users where lower(email) = $1 limit 1',
    [EMAIL]
  );
  const userId = userRes.rows[0]?.id;

  if (!userId) {
    console.error(`No auth user found for email: ${EMAIL}`);
    console.error('');
    console.error('Create the user first:');
    console.error('  1. Supabase Dashboard → Authentication → Users');
    console.error('  2. Click "Add user" → Create new user');
    console.error(`  3. Email: ${EMAIL} (and set a password or use magic link)`);
    console.error('  4. Run this script again.');
    process.exit(1);
  }

  await client.query(
    `insert into public.profiles (id, email, full_name, status)
     values ($1, $2, $3, 'active')
     on conflict (id) do update
       set email = excluded.email, full_name = excluded.full_name`
  , [userId, EMAIL, FULL_NAME]);

  let orgId;
  const orgRes = await client.query(
    'select id from public.organizations where slug = $1 limit 1',
    [ORG_SLUG]
  );
  if (orgRes.rows[0]?.id) {
    orgId = orgRes.rows[0].id;
    await client.query(
      `update public.organizations set created_by_user_id = $1 where id = $2`,
      [userId, orgId]
    );
  } else {
    const ins = await client.query(
      `insert into public.organizations (name, slug, organization_type, status, created_by_user_id)
       values ($1, $2, $3, 'active', $4)
       returning id`,
      [ORG_NAME, ORG_SLUG, ORG_TYPE, userId]
    );
    orgId = ins.rows[0].id;
  }

  await client.query(
    `insert into public.organization_memberships
       (organization_id, user_id, role, status, invited_by_user_id)
     values ($1, $2, 'org_admin', 'active', $2)
     on conflict (organization_id, user_id) do update
       set role = 'org_admin', status = 'active'`
  , [orgId, userId]);

  console.log('Profile and org membership created:');
  console.log('  email:', EMAIL);
  console.log('  user_id:', userId);
  console.log('  organization:', ORG_SLUG, '(id:', orgId, ')');
  console.log('  role: org_admin');
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
