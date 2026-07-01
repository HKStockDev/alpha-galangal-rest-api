require('dotenv').config({ path: '.env.development' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const TAXONOMY_ID = 'da747382-8b83-4b0c-ad7c-234542e622c4';
const MAP_VERSION = 1;
const DEFAULT_CONFIDENCE = 0.8;

function pickSubIndustry(sicRow, subIndustries) {
  const title = (sicRow.industry_title || '').toLowerCase();
  const match = subIndustries.find((s) => {
    const t = s.title.toLowerCase();
    if (title.includes('forest') || title.includes('forestry')) return t.includes('forest');
    if (title.includes('fish') || title.includes('hunt') || title.includes('trap')) return t.includes('agricultural') && t.includes('services');
    if (title.includes('agricultural') || title.includes('crop') || title.includes('livestock') || title.includes('animal')) return t.includes('agricultural');
    return false;
  });
  return match ? match.node_id : subIndustries[0].node_id;
}

async function main() {
  const raw = fs.readFileSync(path.join('/Users/alexp/Downloads', 'sic_codes.json'), 'utf8');
  const sicRows = JSON.parse(raw);

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
    `SELECT node_id, title FROM taxonomy_nodes
     WHERE taxonomy_id = $1 AND level = 'sub_industry' ORDER BY code`,
    [TAXONOMY_ID]
  );
  const subIndustries = subRes.rows;
  if (subIndustries.length === 0) {
    console.error('No sub_industry nodes found for taxonomy', TAXONOMY_ID);
    process.exit(1);
  }

  let inserted = 0;
  for (const row of sicRows) {
    const sicCode = parseInt(row.sic_code, 10);
    if (isNaN(sicCode) || sicCode < 0 || sicCode > 9999) {
      console.warn('Skip invalid sic_code:', row.sic_code);
      continue;
    }
    const subIndustryNodeId = pickSubIndustry(row, subIndustries);
    const sicDescriptionPattern = row.industry_title || null;
    await client.query(
      `INSERT INTO public.sic_to_taxonomy_map
       (taxonomy_id, sic_code, sic_description_pattern, sub_industry_node_id, confidence, map_version, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (taxonomy_id, sic_code, sic_description_pattern, sub_industry_node_id, map_version)
       DO NOTHING`,
      [TAXONOMY_ID, sicCode, sicDescriptionPattern, subIndustryNodeId, DEFAULT_CONFIDENCE, MAP_VERSION]
    );
    inserted++;
  }

  console.log('Done. Inserted/attempted', inserted, 'sic_to_taxonomy_map rows.');
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
