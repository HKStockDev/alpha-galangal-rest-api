/**
 * Fills tags.description using Gemini. Fetches tags from DB, asks Gemini for a
 * short meaningful description per tag (batched), then updates the table.
 * Usage: node scripts/backfill-tag-descriptions.js
 */
require('dotenv').config({ path: '.env.development' });
const { Client } = require('pg');

const GEMINI_MODEL = 'gemini-2.0-flash';
const BATCH_SIZE = 12;
const DELAY_MS = 400;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getDescriptionsFromGemini(apiKey, tagsBatch) {
  const systemPrompt = `You are writing entries for a securities classification tag dictionary.
For each tag you are given its name, slug, and group (e.g. theme, business_model, moat, risk).
Write a single short, meaningful description (1-2 sentences, under 200 characters) that explains what the tag means in the context of labeling stocks or securities. Be precise and useful for analysts.`;

  const tagList = tagsBatch.map((t) => `- name: "${t.name}", slug: "${t.slug}", group: "${t.group}"`).join('\n');
  const slugList = tagsBatch.map((t) => t.slug).join(', ');
  const userPrompt = `Tags to describe:\n${tagList}\n\nReturn a JSON object mapping each slug to its description string. Keys must be exactly these slugs: ${slugList}\nExample: {"ai_infrastructure": "Companies providing...", "cybersecurity": "..."}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? data?.message ?? res.statusText);
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text ?? '').join('').trim();
  if (!text) throw new Error('Empty Gemini response');
  let raw = text;
  const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (codeBlock) raw = codeBlock[1].trim();
  return JSON.parse(raw);
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set.');
    process.exit(1);
  }

  const projectRef = process.env.SUPABASE_PROJECT_ID || new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  const client = new Client({
    host: 'db.' + projectRef + '.supabase.co',
    port: 5432,
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: tags } = await client.query(
    `SELECT tag_id, name, slug, "group" FROM tags ORDER BY "group", slug`
  );
  if (tags.length === 0) {
    console.log('No tags found.');
    await client.end();
    return;
  }

  let updated = 0;
  for (let i = 0; i < tags.length; i += BATCH_SIZE) {
    const batch = tags.slice(i, i + BATCH_SIZE);
    const descMap = await getDescriptionsFromGemini(apiKey, batch);
    await delay(DELAY_MS);
    for (const tag of batch) {
      const desc = descMap[tag.slug];
      const text = typeof desc === 'string' ? desc.trim().slice(0, 1000) : null;
      if (text) {
        await client.query(
          `UPDATE tags SET description = $1, updated_at = now() WHERE tag_id = $2`,
          [text, tag.tag_id]
        );
        updated++;
        console.log(`[${updated}/${tags.length}] ${tag.slug}: ${text.slice(0, 60)}...`);
      } else {
        console.warn(`No description for slug: ${tag.slug}`);
      }
    }
  }
  console.log('\nDone. Tags with description:', updated);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
