require('./pg-client.cjs').loadEnv();
const { createClient } = require('@supabase/supabase-js');

const ORG_ID = '6ffb6e99-2733-489f-9e81-6ddf75a9be88';

function formatPgVector(values) {
  return `[${values.join(',')}]`;
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const vector = Array.from({ length: 768 }, (_, i) => (i + 1) * 0.0001);
  const row = {
    organization_id: ORG_ID,
    organization_client_id: null,
    source_type: 'chat_message',
    source_id: '00000000-0000-4000-8000-000000000099',
    title: 'upsert-only diagnostic',
    content: 'diagnostic chunk without live embedding api',
    content_hash: 'diag-upsert-only-' + Date.now(),
    embedding: formatPgVector(vector),
    embedded_at: new Date().toISOString(),
    source_updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('organization_knowledge_chunks')
    .upsert(row, { onConflict: 'source_type,source_id,content_hash' })
    .select('id, source_type')
    .single();

  if (error) {
    console.error('UPSERT FAILED:', error.message, error.details);
    process.exit(1);
  }
  console.log('UPSERT OK:', data);

  const { data: hits, error: rpcErr } = await sb.rpc('search_organization_knowledge', {
    p_organization_id: ORG_ID,
    p_organization_client_id: null,
    p_query_embedding: formatPgVector(vector),
    p_source_types: null,
    p_match_count: 3,
  });
  if (rpcErr) {
    console.error('RPC FAILED:', rpcErr.message);
    process.exit(1);
  }
  console.log('RPC OK hits:', hits?.length ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
