/**
 * Audit (and optionally purge) placeholder marketing / knowledge text.
 * Usage:
 *   node scripts/audit-placeholder-content.cjs
 *   node scripts/audit-placeholder-content.cjs --purge-knowledge
 */
const { createClient } = require('@supabase/supabase-js');
const { createPgClient, loadEnv } = require('./pg-client.cjs');

loadEnv();

const PLACEHOLDER_SQL = `
  content ILIKE '%placeholder%'
  OR content ILIKE '%sample content%'
  OR content ILIKE '%Use the admin panel%'
  OR content ILIKE '%Seed data for admin%'
  OR content ILIKE '%Second seed release%'
  OR title ILIKE '%Sample release%'
  OR subtitle ILIKE '%Seed data%'
  OR subtitle ILIKE '%sample release%'
`;

const PLACEHOLDER_OR = [
  'body.ilike.%placeholder%',
  'body.ilike.%sample content%',
  'body.ilike.%Use the admin panel%',
  'body.ilike.%Seed data for admin%',
  'title.ilike.%Sample release%',
  'subtitle.ilike.%Seed data%',
  'subtitle.ilike.%sample release%',
].join(',');

const CHUNK_OR = [
  'content.ilike.%placeholder%',
  'content.ilike.%sample content%',
  'content.ilike.%Use the admin panel%',
  'content.ilike.%Seed data for admin%',
  'title.ilike.%Sample release%',
].join(',');

async function main() {
  const purge = process.argv.includes('--purge-knowledge');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const pg = createPgClient();
  await pg.connect();

  console.log('=== Placeholder content audit ===\n');

  const releaseHits = await pg.query(`
    SELECT id, title, LEFT(body, 100) AS body_snippet
    FROM formula_marketing_releases
    WHERE ${PLACEHOLDER_SQL.replace(/content/g, 'body')}
       OR title ILIKE '%Sample release%'
       OR subtitle ILIKE '%Seed data%'
       OR subtitle ILIKE '%sample release%'
       OR body ILIKE '%placeholder%'
       OR body ILIKE '%sample content%'
       OR body ILIKE '%Use the admin panel%'
    ORDER BY title
    LIMIT 20
  `);

  const releaseCount = await pg.query(`
    SELECT COUNT(*)::int AS n FROM formula_marketing_releases
    WHERE body ILIKE '%placeholder%'
       OR body ILIKE '%sample content%'
       OR body ILIKE '%Use the admin panel%'
       OR body ILIKE '%Seed data for admin%'
       OR title ILIKE '%Sample release%'
       OR subtitle ILIKE '%Seed data%'
       OR subtitle ILIKE '%Second seed release%'
  `);

  const chunkCount = await pg.query(`
    SELECT COUNT(*)::int AS n FROM organization_knowledge_chunks
    WHERE content ILIKE '%placeholder%'
       OR content ILIKE '%sample content%'
       OR content ILIKE '%Use the admin panel%'
       OR content ILIKE '%Seed data for admin%'
       OR title ILIKE '%Sample release%'
  `);

  const chunkByType = await pg.query(`
    SELECT source_type, COUNT(*)::int AS n
    FROM organization_knowledge_chunks
    WHERE content ILIKE '%placeholder%'
       OR content ILIKE '%sample content%'
       OR content ILIKE '%Use the admin panel%'
       OR content ILIKE '%Seed data for admin%'
       OR title ILIKE '%Sample release%'
    GROUP BY source_type
  `);

  const chatPlaceholder = await pg.query(`
    SELECT COUNT(*)::int AS n FROM organization_knowledge_chunks
    WHERE source_type = 'chat_message'
      AND (content ILIKE '%placeholder marketing copy%'
        OR content ILIKE '%sample content%'
        OR content ILIKE '%no substantive release copy%')
  `);

  console.log('formula_marketing_releases with placeholder patterns:', releaseCount.rows[0].n);
  if (releaseHits.rows.length) {
    console.table(releaseHits.rows);
  }

  console.log('\norganization_knowledge_chunks with placeholder patterns:', chunkCount.rows[0].n);
  if (chunkByType.rows.length) {
    console.table(chunkByType.rows);
  }

  console.log('\nchat_message chunks echoing old placeholder answers:', chatPlaceholder.rows[0].n);

  if (purge && chunkCount.rows[0].n > 0) {
    const { error, count } = await sb
      .from('organization_knowledge_chunks')
      .delete({ count: 'exact' })
      .or(CHUNK_OR);
    if (error) throw error;
    console.log(`\nPurged ${count ?? 0} knowledge chunk(s) with placeholder patterns.`);
  } else if (chunkCount.rows[0].n > 0) {
    console.log('\nRun with --purge-knowledge to delete stale knowledge chunks.');
    console.log('Then: npm run backfill:knowledge-index -- --org-id <org-id>');
  }

  if (purge) {
    const after = await pg.query(`
      SELECT COUNT(*)::int AS n FROM organization_knowledge_chunks
      WHERE content ILIKE '%placeholder%'
         OR content ILIKE '%sample content%'
         OR content ILIKE '%Use the admin panel%'
         OR content ILIKE '%Seed data for admin%'
         OR title ILIKE '%Sample release%'
    `);
    chunkCount.rows[0].n = after.rows[0].n;
  }

  const totalBad = releaseCount.rows[0].n + chunkCount.rows[0].n;
  console.log(`\n=== Result: ${totalBad === 0 ? 'CLEAN' : 'ISSUES REMAIN'} (releases + chunks = ${totalBad}) ===`);

  await pg.end();
  process.exit(totalBad > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
