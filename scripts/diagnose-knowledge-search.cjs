/**
 * Diagnose pgvector knowledge search pipeline.
 * Usage: node scripts/diagnose-knowledge-search.cjs
 */
const { createPgClient } = require('./pg-client.cjs');

async function q(client, label, sql, params = []) {
  console.log(`\n=== ${label} ===`);
  try {
    const r = await client.query(sql, params);
    console.table(r.rows);
    return r.rows;
  } catch (e) {
    console.error('ERROR:', e.message);
    return null;
  }
}

async function testEmbedding(apiKey) {
  console.log('\n=== Gemini embedding API ===');
  const body = JSON.stringify({
    requests: [
      {
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: 'dividend income' }] },
        outputDimensionality: 768,
      },
    ],
  });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('FAIL', res.status, data?.error?.message ?? JSON.stringify(data));
    return false;
  }
  const dims = data.embeddings?.[0]?.values?.length ?? 0;
  console.log(`OK: embedding_dims=${dims}`);
  return dims === 768;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    await testEmbedding(apiKey);
  } else {
    console.log('\n=== Gemini embedding API ===');
    console.log('SKIP: GEMINI_API_KEY not in env');
  }

  const client = createPgClient();
  await client.connect();

  await q(client, 'pgvector extension', `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`);
  await q(client, 'search RPC exists', `SELECT proname FROM pg_proc WHERE proname = 'search_organization_knowledge'`);
  await q(client, 'knowledge chunks count', `SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS with_embedding FROM organization_knowledge_chunks`);

  const orgs = await q(
    client,
    'organizations with LLM chats',
    `SELECT DISTINCT c.organization_id, o.name, COUNT(m.id)::int AS message_count
     FROM organization_llm_conversations c
     JOIN organizations o ON o.id = c.organization_id
     LEFT JOIN organization_llm_messages m ON m.conversation_id = c.id
     GROUP BY c.organization_id, o.name
     ORDER BY message_count DESC
     LIMIT 5`,
  );

  if (orgs?.length) {
    const orgId = orgs[0].organization_id;
    await q(
      client,
      `indexable chat messages (org ${orgId})`,
      `SELECT COUNT(*)::int AS chat_messages_ge_20_chars
       FROM organization_llm_messages m
       JOIN organization_llm_conversations c ON c.id = m.conversation_id
       WHERE c.organization_id = $1 AND length(trim(m.content)) >= 20`,
      [orgId],
    );
    await q(
      client,
      `indexable client risk notes (org ${orgId})`,
      `SELECT COUNT(*)::int AS client_entities_with_notes
       FROM client_entities ce
       JOIN organization_clients oc ON oc.id = ce.client_id
       WHERE oc.organization_id = $1
         AND (btrim(coalesce(ce.risk_notes,'')) <> '' OR btrim(coalesce(ce.notes,'')) <> '')`,
      [orgId],
    );
    await q(
      client,
      `indexable formula releases (org ${orgId})`,
      `SELECT COUNT(*)::int AS published_releases_with_body
       FROM formula_marketing_releases r
       JOIN formulas f ON f.id = r.formula_id
       WHERE r.is_published = true
         AND btrim(coalesce(r.body,'')) <> ''
         AND length(btrim(r.body)) >= 20
         AND (f.organization_id = $1 OR f.visibility = 'public')`,
      [orgId],
    );
    await q(
      client,
      'RLS policies on knowledge_chunks',
      `SELECT polname, polcmd, polroles::regrole[]
       FROM pg_policy
       WHERE polrelid = 'public.organization_knowledge_chunks'::regclass`,
    );
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
