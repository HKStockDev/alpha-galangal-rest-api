/**
 * End-to-end test: embed one text + upsert into organization_knowledge_chunks.
 */
require('./pg-client.cjs').loadEnv();
const { createClient } = require('@supabase/supabase-js');

const ORG_ID = '6ffb6e99-2733-489f-9e81-6ddf75a9be88';

function formatPgVector(values) {
  return `[${values.join(',')}]`;
}

async function embed(apiKey, text) {
  const body = {
    requests: [
      {
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      },
    ],
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`embed ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  }
  return data.embeddings[0].values;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gemini = process.env.GEMINI_API_KEY;
  if (!url || !key || !gemini) {
    throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or GEMINI_API_KEY');
  }

  console.log('Step 1: embed test text...');
  const vector = await embed(gemini, 'dividend income test chunk');
  console.log(`  OK dims=${vector.length}`);

  const sb = createClient(url, key);
  const row = {
    organization_id: ORG_ID,
    organization_client_id: null,
    source_type: 'chat_message',
    source_id: '00000000-0000-4000-8000-000000000001',
    title: 'diagnostic test',
    content: 'dividend income test chunk for pgvector diagnostic',
    content_hash: 'diag-test-hash-' + Date.now(),
    embedding: formatPgVector(vector),
    embedded_at: new Date().toISOString(),
    source_updated_at: new Date().toISOString(),
  };

  console.log('Step 2: upsert into organization_knowledge_chunks...');
  const { data, error } = await sb
    .from('organization_knowledge_chunks')
    .upsert(row, { onConflict: 'source_type,source_id,content_hash' })
    .select('id, source_type, vector_dims(embedding)')
    .single();

  if (error) {
    console.error('  UPSERT FAILED:', error.message, error.details, error.hint);
    process.exit(1);
  }
  console.log('  OK', data);

  console.log('Step 3: RPC search...');
  const { data: hits, error: rpcErr } = await sb.rpc('search_organization_knowledge', {
    p_organization_id: ORG_ID,
    p_organization_client_id: null,
    p_query_embedding: formatPgVector(vector),
    p_source_types: null,
    p_match_count: 3,
  });
  if (rpcErr) {
    console.error('  RPC FAILED:', rpcErr.message);
    process.exit(1);
  }
  console.log(`  OK hits=${hits?.length ?? 0}`);
  if (hits?.[0]) console.log('  top:', hits[0].title, hits[0].similarity);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
