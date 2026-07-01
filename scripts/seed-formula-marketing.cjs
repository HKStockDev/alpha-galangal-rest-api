/**
 * Seeding: set marketing_slug (Gemini), marketing_settings, visibility=public
 * for all rows in public.formulas. Does not modify hero_image_url.
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
 *
 * Usage: node scripts/seed-formula-marketing.cjs
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');

const GEMINI_MODEL = 'gemini-2.0-flash-lite';
const MARKETING_SETTINGS = {
  cta_key: 'Create Account',
  public_ticker_limit: 5,
  default_sort: 'score_desc',
};

function slugifyKey(key) {
  return (
    String(key)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'formula'
  );
}

function sanitizeSlug(raw) {
  const line = String(raw)
    .split('\n')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (line && line.length >= 2 ? line : null) || null;
}

async function callGeminiSlug(name, key, apiKey) {
  const prompt = `Return exactly one line: a short URL slug (kebab-case, a-z 0-9 and hyphens only, max 50 chars) for a finance product public marketing page. No quotes, no other text.\nProduct name: ${name}\nInternal key: ${key}\nSlug:`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || JSON.stringify(data).slice(0, 200));
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return sanitizeSlug(text) || slugifyKey(key);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!geminiKey) {
    console.error('Missing GEMINI_API_KEY (needed for marketing_slug; set in .env)');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: rows, error: selErr } = await supabase
    .from('formulas')
    .select('id, organization_id, key, name')
    .order('name');
  if (selErr) {
    console.error(selErr);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log('No formulas found.');
    return;
  }

  const byOrg = new Map();
  for (const r of rows) {
    if (!byOrg.has(r.organization_id)) {
      byOrg.set(r.organization_id, new Set());
    }
  }

  let ok = 0;
  for (const row of rows) {
    const orgId = row.organization_id;
    const used = byOrg.get(orgId);

    let baseSlug;
    try {
      baseSlug = await callGeminiSlug(row.name, row.key, geminiKey);
    } catch (e) {
      console.warn(`Gemini failed for ${row.key}, using key slug:`, e.message);
      baseSlug = slugifyKey(row.key);
    }

    let candidate = baseSlug;
    let n = 2;
    while (used.has(candidate)) {
      const suffix = `-${n}`;
      candidate = (baseSlug + suffix).slice(0, 200);
      n += 1;
    }
    used.add(candidate);

    const { error: upErr } = await supabase
      .from('formulas')
      .update({
        marketing_slug: candidate,
        marketing_settings: MARKETING_SETTINGS,
        visibility: 'public',
      })
      .eq('id', row.id);
    if (upErr) {
      console.error(`Update failed for ${row.key} (${row.id}):`, upErr.message);
    } else {
      console.log(`OK  ${row.key} → slug "${candidate}"`);
      ok += 1;
    }
    await sleep(150);
  }

  console.log(`\nUpdated ${ok}/${rows.length} formulas. hero_image_url left unchanged.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
