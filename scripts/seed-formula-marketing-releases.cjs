/**
 * Idempotent: ensures exactly two sample marketing releases per formula in public.formulas.
 * Slugs: {slugify(key)}-{8 hex from uuid}-seed-1|2 (globally unique; avoids key slugify collisions).
 *
 * Does not insert formula_marketing_release_rows (tickers). Does not create hero images.
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage: node scripts/seed-formula-marketing-releases.cjs
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');
const { getReleaseContent, fallbackContent } = require('./formula-marketing-release-content.cjs');

const SETTINGS = {
  cta_key: 'Create Account',
  public_ticker_limit: 5,
  default_sort: 'score_desc',
};

function slugifyKey(key) {
  const s = String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'formula';
}

function releaseSlugForFormula(f) {
  const short = String(f.id).replace(/-/g, '').slice(0, 8);
  const base = slugifyKey(f.key);
  return {
    a: `${base}-${short}-seed-1`,
    b: `${base}-${short}-seed-2`,
  };
}

const AS_OF_1 = '2024-10-15T20:00:00.000Z';
const PUB_1 = '2024-10-16T12:00:00.000Z';
const AS_OF_2 = '2025-01-20T20:00:00.000Z';
const PUB_2 = '2025-01-22T10:00:00.000Z';

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: formulas, error: selErr } = await supabase
    .from('formulas')
    .select('id, key, name')
    .order('name');
  if (selErr) {
    console.error(selErr);
    process.exit(1);
  }
  if (!formulas?.length) {
    console.log('No formulas found.');
    return;
  }

  let inserted = 0;
  let skipped = 0;
  for (const f of formulas) {
    const { a: slug1, b: slug2 } = releaseSlugForFormula(f);
    const { data: existing, error: exErr } = await supabase
      .from('formula_marketing_releases')
      .select('slug')
      .eq('formula_id', f.id)
      .in('slug', [slug1, slug2]);
    if (exErr) {
      console.error('query releases:', exErr);
      process.exit(1);
    }
    const have = new Set((existing ?? []).map((r) => r.slug));
    const toInsert = [];
    const content1 = getReleaseContent(f.key, 'release1') ?? fallbackContent(f.name, f.key, 'release1');
    const content2 = getReleaseContent(f.key, 'release2') ?? fallbackContent(f.name, f.key, 'release2');

    if (!have.has(slug1)) {
      toInsert.push({
        formula_id: f.id,
        slug: slug1,
        title: content1.title,
        subtitle: content1.subtitle,
        body: content1.body,
        seo_title: content1.seo_title ?? null,
        seo_description: content1.seo_description ?? null,
        hero_image_url: null,
        as_of: AS_OF_1,
        published_at: PUB_1,
        is_published: true,
        settings_json: SETTINGS,
        created_by_user_id: null,
        updated_by_user_id: null,
      });
    }
    if (!have.has(slug2)) {
      toInsert.push({
        formula_id: f.id,
        slug: slug2,
        title: content2.title,
        subtitle: content2.subtitle,
        body: content2.body,
        seo_title: content2.seo_title ?? null,
        seo_description: content2.seo_description ?? null,
        hero_image_url: null,
        as_of: AS_OF_2,
        published_at: PUB_2,
        is_published: true,
        settings_json: SETTINGS,
        created_by_user_id: null,
        updated_by_user_id: null,
      });
    }
    if (toInsert.length === 0) {
      skipped += 1;
      continue;
    }
    const { error: insErr } = await supabase.from('formula_marketing_releases').insert(toInsert);
    if (insErr) {
      console.error(`Insert failed for formula ${f.key}:`, insErr.message);
      process.exit(1);
    }
    inserted += toInsert.length;
  }

  console.log(
    `Done. Formulas: ${formulas.length}. Release rows inserted: ${inserted}. Formulas already complete (2 seed releases): ${skipped}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
