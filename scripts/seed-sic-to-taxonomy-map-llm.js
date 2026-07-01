/**
 * Seeds sic_to_taxonomy_map using Gemini to map each SIC to a GICS sub_industry
 * and return a confidence score. Usage: node scripts/seed-sic-to-taxonomy-map-llm.js [path/to/sic_codes.json]
 * Default path: scripts/sic_codes_llm.json. Requires GEMINI_API_KEY in env.
 */
require('dotenv').config({ path: '.env.development' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const TAXONOMY_ID = 'da747382-8b83-4b0c-ad7c-234542e622c4';
const MAP_VERSION = 1;
const GEMINI_MODEL = 'gemini-2.0-flash';
const DELAY_MS = 500;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGeminiForMapping(apiKey, sicRow, subIndustriesList) {
  const systemPrompt = `You are a classifier that maps US SIC (Standard Industrial Classification) codes to GICS (Global Industry Classification Standard) sub-industries.
Given a SIC code with its office and industry_title, and a list of GICS sub_industries (each with "code" and "title"), respond with exactly one best-matching GICS sub_industry and a confidence between 0 and 1.
Respond only with valid JSON in this exact shape (no markdown, no extra text):
{"gics_code":"<8-digit GICS code>","confidence":<0-1 number>,"reasoning":"<optional short explanation>"}
If the match is uncertain, use a lower confidence (e.g. 0.5-0.7). If very clear, use 0.85-1.0.`;

  const userPrompt = `SIC to map:
- sic_code: ${sicRow.sic_code}
- office: ${sicRow.office || ''}
- industry_title: ${sicRow.industry_title || ''}

GICS sub_industries (choose exactly one by its code):
${subIndustriesList}

Return JSON: {"gics_code":"...", "confidence": <0-1>, "reasoning":"..."}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = data?.error?.message || data?.message || res.statusText;
    throw new Error(`Gemini API: ${err}`);
  }
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text ?? '').join('').trim();
  if (!text) throw new Error('Empty Gemini response');
  let raw = text;
  const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (codeBlock) raw = codeBlock[1].trim();
  const parsed = JSON.parse(raw);
  const gicsCode = String(parsed.gics_code ?? '').trim();
  let confidence = Number(parsed.confidence);
  if (Number.isNaN(confidence) || confidence < 0) confidence = 0.5;
  if (confidence > 1) confidence = 1;
  return { gicsCode, confidence, reasoning: parsed.reasoning };
}

async function main() {
  const jsonPath = process.argv[2] || path.join(__dirname, 'sic_codes_llm.json');
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const sicRows = JSON.parse(raw);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set. Set it in .env.development or the environment.');
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

  const subRes = await client.query(
    `SELECT node_id, code, title FROM taxonomy_nodes
     WHERE taxonomy_id = $1 AND level = 'sub_industry' ORDER BY code`,
    [TAXONOMY_ID]
  );
  const subIndustries = subRes.rows;
  const codeToNode = Object.fromEntries(subIndustries.map((r) => [String(r.code).trim(), r.node_id]));
  const subIndustriesList = subIndustries.map((r) => `${r.code}: ${r.title}`).join('\n');

  if (subIndustries.length === 0) {
    console.error('No sub_industry nodes found for taxonomy', TAXONOMY_ID);
    process.exit(1);
  }

  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < sicRows.length; i++) {
    const row = sicRows[i];
    const sicCode = parseInt(row.sic_code, 10);
    if (isNaN(sicCode) || sicCode < 0 || sicCode > 9999) {
      console.warn('Skip invalid sic_code:', row.sic_code);
      continue;
    }
    try {
      const { gicsCode, confidence } = await callGeminiForMapping(apiKey, row, subIndustriesList);
      await delay(DELAY_MS);
      const nodeId = codeToNode[gicsCode];
      if (!nodeId) {
        console.warn(`SIC ${sicCode}: Gemini returned unknown gics_code "${gicsCode}", skipping.`);
        failed++;
        continue;
      }
      const sicDescriptionPattern = row.industry_title || null;
      await client.query(
        `INSERT INTO public.sic_to_taxonomy_map
         (taxonomy_id, sic_code, sic_description_pattern, sub_industry_node_id, confidence, map_version, is_active, notes)
         VALUES ($1, $2, $3, $4, $5, $6, true, 'llm_assisted')
         ON CONFLICT (taxonomy_id, sic_code, sic_description_pattern, sub_industry_node_id, map_version)
         DO UPDATE SET confidence = EXCLUDED.confidence, notes = EXCLUDED.notes, updated_at = now()`,
        [TAXONOMY_ID, sicCode, sicDescriptionPattern, nodeId, confidence, MAP_VERSION]
      );
      inserted++;
      console.log(`[${i + 1}/${sicRows.length}] SIC ${sicCode} -> GICS ${gicsCode} (confidence ${confidence.toFixed(2)})`);
    } catch (e) {
      console.error(`SIC ${sicCode}:`, e.message);
      failed++;
    }
  }

  console.log(`Done. Inserted/updated: ${inserted}, failed: ${failed}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
