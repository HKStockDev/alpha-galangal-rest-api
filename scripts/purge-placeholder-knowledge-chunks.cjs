/**
 * Remove stale formula_release_body knowledge chunks that still contain seed placeholder text.
 * Usage: node scripts/purge-placeholder-knowledge-chunks.cjs
 */
const { createClient } = require('@supabase/supabase-js');
const { loadEnv } = require('./pg-client.cjs');

loadEnv();

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { count: before } = await sb
    .from('organization_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('source_type', 'formula_release_body')
    .or('content.ilike.%placeholder%,content.ilike.%sample content%,content.ilike.%Use the admin panel%');
  console.log(`Stale placeholder chunks before purge: ${before ?? 0}`);

  const { error, count } = await sb
    .from('organization_knowledge_chunks')
    .delete({ count: 'exact' })
    .eq('source_type', 'formula_release_body')
    .or('content.ilike.%placeholder%,content.ilike.%sample content%,content.ilike.%Use the admin panel%');
  if (error) {
    throw error;
  }
  console.log(`Deleted ${count ?? 0} stale placeholder knowledge chunk(s).`);

  const { count: capital } = await sb
    .from('organization_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('source_type', 'formula_release_body')
    .ilike('content', '%capital preservation%');
  console.log(`Formula release chunks mentioning capital preservation: ${capital ?? 0}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
