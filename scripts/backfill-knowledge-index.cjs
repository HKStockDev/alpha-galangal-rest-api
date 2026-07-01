/**
 * Pre-index org knowledge chunks (Method 1: embed before search).
 *
 * Usage:
 *   node scripts/backfill-knowledge-index.cjs --dry-run
 *   node scripts/backfill-knowledge-index.cjs --org-id 6ffb6e99-2733-489f-9e81-6ddf75a9be88
 *   node scripts/backfill-knowledge-index.cjs --all-orgs
 */
const crypto = require('crypto');
require('./pg-client.cjs').loadEnv();
const { createClient } = require('@supabase/supabase-js');

const EMBEDDING_MODEL = process.env.ASSISTANT_EMBEDDING_MODEL || 'gemini-embedding-001';
const EMBEDDING_DIMS = 768;
const BATCH = Number(process.env.ASSISTANT_KNOWLEDGE_EMBED_BATCH || 16);

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isPlaceholderEchoContent(content) {
  return /placeholder marketing copy|sample content|use the admin panel to replace|seed data for admin|no substantive release copy discussing/i.test(
    content,
  );
}

function formatPgVector(values) {
  return `[${values.join(',')}]`;
}

async function embedBatch(apiKey, texts) {
  const modelId = EMBEDDING_MODEL.startsWith('models/')
    ? EMBEDDING_MODEL
    : `models/${EMBEDDING_MODEL}`;
  const requests = texts.map((text) => ({
    model: modelId,
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMS,
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelId}:batchEmbedContents?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`embed ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  }
  return (data.embeddings || []).map((row) => row.values);
}

function buildClientEntityContent(row) {
  const parts = [row.risk_notes?.trim(), row.notes?.trim()].filter(Boolean);
  if (!parts.length) return null;
  return `Client entity: ${row.display_name}\n${parts.join('\n\n')}`;
}

async function collectSources(sb, orgId) {
  const sources = [];

  const { data: clients } = await sb
    .from('organization_clients')
    .select('id')
    .eq('organization_id', orgId)
    .limit(500);
  const clientIds = (clients || []).map((c) => c.id);
  if (clientIds.length) {
    const { data: entities } = await sb
      .from('client_entities')
      .select('id, display_name, risk_notes, notes, updated_at, client_id')
      .in('client_id', clientIds)
      .limit(500);
    for (const row of entities || []) {
      const content = buildClientEntityContent(row);
      if (!content) continue;
      sources.push({
        organization_id: orgId,
        organization_client_id: row.client_id,
        source_type: 'client_entity_risk_notes',
        source_id: row.id,
        title: row.display_name,
        content,
        content_hash: hashContent(content),
        source_updated_at: row.updated_at || new Date().toISOString(),
      });
    }
  }

  const { data: formulas } = await sb
    .from('formulas')
    .select('id, name')
    .or(`organization_id.eq.${orgId},visibility.eq.public`);
  const formulaIds = (formulas || []).map((f) => f.id);
  const formulaNameById = new Map((formulas || []).map((f) => [f.id, f.name]));
  if (formulaIds.length) {
    const { data: releases } = await sb
      .from('formula_marketing_releases')
      .select('id, formula_id, title, subtitle, body, updated_at')
      .in('formula_id', formulaIds)
      .eq('is_published', true)
      .not('body', 'is', null)
      .limit(200);
    for (const row of releases || []) {
      const body = (row.body || '').trim();
      if (!body || body.length < 20 || isPlaceholderEchoContent(body)) continue;
      const titleParts = [
        formulaNameById.get(row.formula_id),
        row.title,
        row.subtitle,
      ].filter(Boolean);
      const content = titleParts.length ? `${titleParts.join(' — ')}\n\n${body}` : body;
      sources.push({
        organization_id: orgId,
        organization_client_id: null,
        source_type: 'formula_release_body',
        source_id: row.id,
        title: row.title,
        content,
        content_hash: hashContent(content),
        source_updated_at: row.updated_at || new Date().toISOString(),
      });
    }
  }

  const { data: conversations } = await sb
    .from('organization_llm_conversations')
    .select('id, organization_client_id')
    .eq('organization_id', orgId)
    .limit(200);
  const convIds = (conversations || []).map((c) => c.id);
  const clientByConv = new Map((conversations || []).map((c) => [c.id, c.organization_client_id]));
  if (convIds.length) {
    const { data: messages } = await sb
      .from('organization_llm_messages')
      .select('id, conversation_id, role, content, created_at')
      .in('conversation_id', convIds)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(300);
    for (const row of messages || []) {
      const content = (row.content || '').trim();
      if (!content || content.length < 20 || isPlaceholderEchoContent(content)) continue;
      sources.push({
        organization_id: orgId,
        organization_client_id: clientByConv.get(row.conversation_id) ?? null,
        source_type: 'chat_message',
        source_id: row.id,
        title: `${row.role} message`,
        content,
        content_hash: hashContent(content),
        source_updated_at: row.created_at || new Date().toISOString(),
      });
    }
  }

  return sources;
}

async function backfillOrg(sb, apiKey, orgId, dryRun) {
  console.log(`\nOrg ${orgId}`);
  const sources = await collectSources(sb, orgId);
  console.log(`  sources found: ${sources.length}`);
  if (!sources.length || dryRun) return { indexed: 0, skipped: sources.length };

  const { data: existingRows } = await sb
    .from('organization_knowledge_chunks')
    .select('source_type, source_id, content_hash')
    .eq('organization_id', orgId);
  const existingMap = new Map(
    (existingRows || []).map((r) => [`${r.source_type}:${r.source_id}`, r.content_hash]),
  );
  const toEmbed = sources.filter((s) => existingMap.get(`${s.source_type}:${s.source_id}`) !== s.content_hash);
  console.log(`  to embed: ${toEmbed.length}, skip unchanged: ${sources.length - toEmbed.length}`);

  for (const source of toEmbed) {
    const { error } = await sb
      .from('organization_knowledge_chunks')
      .delete()
      .eq('organization_id', orgId)
      .eq('source_type', source.source_type)
      .eq('source_id', source.source_id)
      .neq('content_hash', source.content_hash);
    if (error) {
      console.warn(`  stale chunk delete ${source.source_type}:${source.source_id}: ${error.message}`);
    }
  }

  let indexed = 0;
  for (let i = 0; i < toEmbed.length; i += BATCH) {
    const batch = toEmbed.slice(i, i + BATCH);
    const vectors = await embedBatch(
      apiKey,
      batch.map((b) => b.content),
    );
    const now = new Date().toISOString();
    const rows = batch.map((source, idx) => ({
      organization_id: source.organization_id,
      organization_client_id: source.organization_client_id,
      source_type: source.source_type,
      source_id: source.source_id,
      title: source.title,
      content: source.content,
      content_hash: source.content_hash,
      embedding: formatPgVector(vectors[idx]),
      embedded_at: now,
      source_updated_at: source.source_updated_at,
    }));
    const { error } = await sb
      .from('organization_knowledge_chunks')
      .upsert(rows, { onConflict: 'source_type,source_id,content_hash' });
    if (error) throw new Error(`upsert: ${error.message}`);
    indexed += batch.length;
    console.log(`  embedded ${indexed}/${toEmbed.length}`);
  }
  return { indexed, skipped: sources.length - toEmbed.length };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const allOrgs = process.argv.includes('--all-orgs');
  const orgArg = process.argv.find((a) => a.startsWith('--org-id='))?.split('=')[1]
    || (process.argv.includes('--org-id') ? process.argv[process.argv.indexOf('--org-id') + 1] : null);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!url || !key || !apiKey) {
    throw new Error('Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY');
  }

  const sb = createClient(url, key);
  let orgIds = [];
  if (allOrgs) {
    const { data } = await sb.from('organizations').select('id');
    orgIds = (data || []).map((r) => r.id);
  } else {
    orgIds = [orgArg || '6ffb6e99-2733-489f-9e81-6ddf75a9be88'];
  }

  if (dryRun) {
    for (const orgId of orgIds) {
      const sources = await collectSources(sb, orgId);
      console.log(`Org ${orgId}: ${sources.length} indexable sources (dry-run, no embed)`);
    }
    return;
  }

  console.log(`Embedding model: ${EMBEDDING_MODEL}`);
  for (const orgId of orgIds) {
    const stats = await backfillOrg(sb, apiKey, orgId, false);
    console.log(`  done indexed=${stats.indexed} skipped=${stats.skipped}`);
  }

  const { count } = await sb
    .from('organization_knowledge_chunks')
    .select('*', { count: 'exact', head: true });
  console.log(`\nTotal chunks in DB: ${count ?? 0}`);
}

main().catch((e) => {
  console.error('BACKFILL FAILED:', e.message);
  process.exit(1);
});
