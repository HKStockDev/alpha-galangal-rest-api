/**
 * Replace placeholder formula marketing release copy with real content.
 *
 * Usage:
 *   node scripts/refresh-formula-marketing-release-content.cjs
 *   node scripts/refresh-formula-marketing-release-content.cjs --dry-run
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');
const { getReleaseContent, fallbackContent } = require('./formula-marketing-release-content.cjs');

const PLACEHOLDER_RE =
  /placeholder|sample content|sample release|seed data|Use the admin panel to replace/i;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const sb = createClient(url, key);
  const { data: formulas, error: fErr } = await sb
    .from('formulas')
    .select('id, key, name')
    .order('name');
  if (fErr) {
    console.error(fErr);
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let missingContent = 0;

  for (const formula of formulas ?? []) {
    const { data: releases, error: rErr } = await sb
      .from('formula_marketing_releases')
      .select('id, slug, title, subtitle, body, seo_title, seo_description, published_at')
      .eq('formula_id', formula.id)
      .order('published_at', { ascending: true });
    if (rErr) {
      console.error(`releases for ${formula.key}:`, rErr.message);
      process.exit(1);
    }
    if (!releases?.length) {
      continue;
    }

    for (let i = 0; i < releases.length; i++) {
      const release = releases[i];
      const variant = i === 0 ? 'release1' : 'release2';
      let content = getReleaseContent(formula.key, variant);
      if (!content) {
        missingContent += 1;
        content = fallbackContent(formula.name, formula.key, variant);
      }

      const isPlaceholder =
        PLACEHOLDER_RE.test(release.body ?? '') ||
        PLACEHOLDER_RE.test(release.title ?? '') ||
        PLACEHOLDER_RE.test(release.subtitle ?? '');

      const patch = {
        title: content.title,
        subtitle: content.subtitle,
        body: content.body,
        seo_title: content.seo_title ?? null,
        seo_description: content.seo_description ?? null,
        updated_at: new Date().toISOString(),
      };

      if (!isPlaceholder && release.body === patch.body) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(`[dry-run] ${formula.key} / ${release.slug}`);
        console.log(`  title: ${patch.title}`);
        updated += 1;
        continue;
      }

      const { error: uErr } = await sb
        .from('formula_marketing_releases')
        .update(patch)
        .eq('id', release.id);
      if (uErr) {
        console.error(`update ${release.id}:`, uErr.message);
        process.exit(1);
      }
      console.log(`updated ${formula.key} → ${release.slug}`);
      updated += 1;
    }
  }

  console.log(
    `\nDone. Updated: ${updated}. Skipped (already real): ${skipped}. Fallback content used: ${missingContent}.`,
  );
  if (!dryRun && updated > 0) {
    const { error: delErr, count } = await sb
      .from('organization_knowledge_chunks')
      .delete({ count: 'exact' })
      .eq('source_type', 'formula_release_body')
      .or('content.ilike.%placeholder%,content.ilike.%sample content%,content.ilike.%Use the admin panel%');
    if (delErr) {
      console.warn('Could not delete stale placeholder knowledge chunks:', delErr.message);
    } else {
      console.log(`Removed ${count ?? 0} stale placeholder knowledge chunk(s).`);
    }
    console.log(
      '\nRe-index knowledge chunks (run on your API machine): npm run backfill:knowledge-index -- --org-id <your-org-id>',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
