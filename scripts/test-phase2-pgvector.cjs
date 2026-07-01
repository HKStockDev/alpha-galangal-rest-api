/**
 * End-to-end test for CON-105 Phase 2 pgvector knowledge search.
 * Usage: node scripts/test-phase2-pgvector.cjs [--org-id <uuid>]
 */
const { createPgClient, loadEnv } = require('./pg-client.cjs');

loadEnv();

const EMBEDDING_MODEL = process.env.ASSISTANT_EMBEDDING_MODEL || 'gemini-embedding-001';
const EMBEDDING_DIMS = 768;
const DEFAULT_ORG = '6ffb6e99-2733-489f-9e81-6ddf75a9be88';

function parseOrgId() {
  const idx = process.argv.indexOf('--org-id');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return DEFAULT_ORG;
}

function formatPgVector(values) {
  return `[${values.join(',')}]`;
}

async function embedText(apiKey, text) {
  const modelId = EMBEDDING_MODEL.startsWith('models/')
    ? EMBEDDING_MODEL
    : `models/${EMBEDDING_MODEL}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelId}:batchEmbedContents?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            model: modelId,
            content: { parts: [{ text }] },
            outputDimensionality: EMBEDDING_DIMS,
          },
        ],
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`embed ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  }
  const values = data.embeddings?.[0]?.values;
  if (!values || values.length !== EMBEDDING_DIMS) {
    throw new Error(`unexpected embedding dims: ${values?.length ?? 0}`);
  }
  return values;
}

async function searchRpc(client, orgId, queryEmbedding, sourceTypes, limit = 5, vectorLiteralOverride) {
  const vectorLiteral =
    vectorLiteralOverride ?? (queryEmbedding ? formatPgVector(queryEmbedding) : null);
  if (!vectorLiteral) {
    throw new Error('searchRpc requires queryEmbedding or vectorLiteralOverride');
  }
  const { rows } = await client.query(
    `SELECT * FROM search_organization_knowledge($1::uuid, NULL::uuid, $2::vector, $3::text[], $4::int)`,
    [orgId, vectorLiteral, sourceTypes, limit],
  );
  return { rows, rowCount: rows.length };
}

function printResults(label, rows) {
  console.log(`\n--- ${label} (${rows.length} hits) ---`);
  if (!rows.length) {
    console.log('  (no results)');
    return;
  }
  for (const row of rows) {
    const sim = Number(row.similarity).toFixed(4);
    const snippet = String(row.content).replace(/\s+/g, ' ').slice(0, 100);
    console.log(`  [${sim}] ${row.source_type} | ${row.title ?? '(no title)'}`);
    console.log(`        ${snippet}...`);
  }
}

async function main() {
  const orgId = parseOrgId();
  const apiKey = process.env.GEMINI_API_KEY;
  const results = { passed: 0, failed: 0, checks: [] };

  function pass(name, detail) {
    results.passed += 1;
    results.checks.push({ status: 'PASS', name, detail });
    console.log(`PASS  ${name}${detail ? `: ${detail}` : ''}`);
  }

  function fail(name, detail) {
    results.failed += 1;
    results.checks.push({ status: 'FAIL', name, detail });
    console.error(`FAIL  ${name}${detail ? `: ${detail}` : ''}`);
  }

  console.log('=== Phase 2 pgvector E2E test ===');
  console.log(`org_id: ${orgId}`);

  const client = createPgClient();
  await client.connect();

  // 1. Infrastructure
  const ext = await client.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
  if (ext.rows[0]?.extversion) {
    pass('pgvector extension', `v${ext.rows[0].extversion}`);
  } else {
    fail('pgvector extension', 'not installed');
  }

  const rpc = await client.query(
    `SELECT COUNT(*)::int AS n FROM pg_proc WHERE proname = 'search_organization_knowledge'`,
  );
  if (rpc.rows[0]?.n > 0) {
    pass('search_organization_knowledge RPC', 'exists');
  } else {
    fail('search_organization_knowledge RPC', 'missing');
  }

  const chunks = await client.query(
    `SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS embedded
     FROM organization_knowledge_chunks WHERE organization_id = $1`,
    [orgId],
  );
  const { total, embedded } = chunks.rows[0] ?? { total: 0, embedded: 0 };
  if (total > 0 && total === embedded) {
    pass('indexed chunks', `${total} chunks, all embedded`);
  } else if (total > 0) {
    fail('indexed chunks', `${embedded}/${total} have embeddings`);
  } else {
    fail('indexed chunks', 'no chunks for org — run backfill-knowledge-index first');
  }

  const hnsw = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'organization_knowledge_chunks' AND indexname LIKE '%embedding%'`,
  );
  if (hnsw.rows.length > 0) {
    pass('HNSW index', hnsw.rows.map((r) => r.indexname).join(', '));
  } else {
    fail('HNSW index', 'not found');
  }

  // 2. Embedding API (optional — falls back to stored vectors if unavailable)
  let liveEmbedding = false;
  if (!apiKey) {
    fail('Gemini embedding API', 'GEMINI_API_KEY not set');
  } else {
    try {
      await embedText(apiKey, 'dividend income conservative portfolio');
      liveEmbedding = true;
      pass('Gemini embedding API', `${EMBEDDING_DIMS} dimensions`);
    } catch (e) {
      fail('Gemini embedding API', e.message);
      console.log('  → continuing with stored-embedding RPC tests');
    }
  }

  // 2b. RPC with stored embedding (no Gemini needed)
  const seed = await client.query(
    `SELECT title, source_type, embedding::text AS vec, LEFT(content, 60) AS snippet
     FROM organization_knowledge_chunks
     WHERE organization_id = $1 AND embedding IS NOT NULL
     LIMIT 1`,
    [orgId],
  );
  if (seed.rows[0]) {
    const { rows: selfRows } = await searchRpc(client, orgId, null, null, 3, seed.rows[0].vec);
    const topSim = selfRows[0] ? Number(selfRows[0].similarity) : 0;
    if (topSim >= 0.99) {
      pass('stored-embedding RPC self-match', `similarity=${topSim.toFixed(4)}`);
      printResults(`Self-match seed: ${seed.rows[0].title}`, selfRows);
    } else {
      fail('stored-embedding RPC self-match', `top similarity=${topSim.toFixed(4)}`);
    }
  } else {
    fail('stored-embedding RPC self-match', 'no chunks with embeddings');
  }

  if (!liveEmbedding) {
    await client.end();
    printSummary(results);
    process.exit(results.failed > 0 ? 1 : 0);
  }

  // 3. RPC semantic search — all source types (live embeddings)
  const queries = [
    { q: 'capital preservation downside protection volatility', filter: null },
    { q: 'client risk notes conservative liquidity', filter: ['client_entity_risk_notes'] },
    { q: 'formula marketing release placeholder sample', filter: ['formula_release_body'] },
    { q: 'Find releases that emphasize capital preservation', filter: ['chat_message'] },
  ];

  for (const { q, filter } of queries) {
    try {
      const vector = await embedText(apiKey, q);
      const { rows } = await searchRpc(client, orgId, vector, filter, 5);
      const topSim = rows[0] ? Number(rows[0].similarity).toFixed(4) : 'n/a';
      const filterLabel = filter ? filter.join(',') : 'all';
      if (rows.length > 0) {
        pass(`semantic search [${filterLabel}]`, `"${q.slice(0, 40)}..." → ${rows.length} hits, top=${topSim}`);
        printResults(`Query: "${q}" (${filterLabel})`, rows);
      } else {
        fail(`semantic search [${filterLabel}]`, `"${q}" returned 0 rows`);
      }
    } catch (e) {
      fail(`semantic search`, e.message);
    }
  }

  // 4. Cosine ordering sanity: closer text should rank higher than unrelated text
  try {
    const preserveVec = await embedText(apiKey, 'preservation of capital low volatility');
    const unrelatedVec = await embedText(apiKey, 'quantum physics particle accelerator');
    const { rows: preserveHits } = await searchRpc(
      client,
      orgId,
      preserveVec,
      ['formula_release_body'],
      3,
    );
    const { rows: unrelatedHits } = await searchRpc(
      client,
      orgId,
      unrelatedVec,
      ['formula_release_body'],
      3,
    );
    const preserveTop = preserveHits[0] ? Number(preserveHits[0].similarity) : 0;
    const unrelatedTop = unrelatedHits[0] ? Number(unrelatedHits[0].similarity) : 0;
    if (preserveTop >= unrelatedTop) {
      pass(
        'cosine ranking sanity',
        `capital query top=${preserveTop.toFixed(4)} >= unrelated top=${unrelatedTop.toFixed(4)}`,
      );
    } else {
      fail(
        'cosine ranking sanity',
        `capital top=${preserveTop.toFixed(4)} < unrelated top=${unrelatedTop.toFixed(4)}`,
      );
    }
  } catch (e) {
    fail('cosine ranking sanity', e.message);
  }

  // 5. Vector dimension mismatch guard
  try {
    await client.query(
      `SELECT * FROM search_organization_knowledge($1::uuid, NULL::uuid, $2::vector, NULL::text[], 1)`,
      [orgId, formatPgVector(Array(768).fill(0))],
    );
    pass('RPC accepts 768-dim vector literal', 'zero vector accepted');
  } catch (e) {
    fail('RPC accepts 768-dim vector literal', e.message);
  }

  await client.end();
  printSummary(results);
  process.exit(results.failed > 0 ? 1 : 0);
}

function printSummary(results) {
  console.log('\n=== Summary ===');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  if (results.failed > 0) {
    console.log('\nFailed checks:');
    for (const c of results.checks.filter((x) => x.status === 'FAIL')) {
      console.log(`  - ${c.name}: ${c.detail}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
