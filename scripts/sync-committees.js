const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });

const CONGRESS_TERM_START_YEAR = 1789;
const COMMITTEE_PAGE_SIZE = 250;

const CHAMBER_MAP = {
  house: 'house', House: 'house',
  senate: 'senate', Senate: 'senate',
  joint: 'joint', Joint: 'joint',
};

const ENTITY_TYPE_COMMITTEE = 'committee';

const COMMITTEE_TYPES = new Set([
  'Standing', 'Select', 'Special', 'Joint', 'Subcommittee',
  'Task Force', 'Commission or Caucus', 'Other',
]);

async function ensureCommitteeEntity(supabase, systemCode, name) {
  const key = systemCode;
  const { data: existing } = await supabase
    .from('entities')
    .select('id')
    .eq('entity_type', ENTITY_TYPE_COMMITTEE)
    .eq('key', key)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: inserted, error } = await supabase
    .from('entities')
    .insert({ entity_type: ENTITY_TYPE_COMMITTEE, key, name: name || key })
    .select('id')
    .single();
  if (error) throw new Error(`Entity insert failed: ${error.message}`);
  return inserted.id;
}

function normalizeChamber(chamber) {
  if (!chamber) return null;
  return CHAMBER_MAP[chamber] ?? null;
}

function normalizeType(type, isSubcommittee) {
  if (isSubcommittee) return 'Subcommittee';
  if (!type) return null;
  return COMMITTEE_TYPES.has(type) ? type : null;
}

function normalizeSystemCode(code) {
  if (!code || typeof code !== 'string') return null;
  let lower = code.trim().toLowerCase();
  const m = lower.match(/^(h|s|j)([a-z0-9]{2,10}[0-9]{2})$/);
  if (m) {
    const prefix = { h: 'hs', s: 'ss', j: 'js' }[m[1]];
    lower = prefix + m[2];
  }
  if (!/^(hs|ss|js)[a-z0-9]{2,10}[0-9]{2}$/.test(lower)) return null;
  return lower;
}

async function fetchCommittees(congress, offset = 0) {
  const apiKey = process.env.CONGRESS_GOV_API_KEY;
  if (!apiKey) throw new Error('CONGRESS_GOV_API_KEY not set');
  const url = new URL(`https://api.congress.gov/v3/committee/${congress}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('limit', String(COMMITTEE_PAGE_SIZE));
  url.searchParams.set('offset', String(offset));
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Congress API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function run() {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY required');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const year = new Date().getFullYear();
  const congress = Math.floor((year - CONGRESS_TERM_START_YEAR) / 2) + 1;

  let offset = 0;
  let synced = 0;
  let errors = 0;
  const seen = new Set();

  for (;;) {
    const data = await fetchCommittees(congress, offset);
    const committees = data.committees || [];
    if (committees.length === 0) break;

    for (const item of committees) {
      const systemCode = normalizeSystemCode(item.systemCode);
      if (!systemCode || seen.has(systemCode)) continue;
      const chamber = normalizeChamber(item.chamber);
      const type = normalizeType(item.committeeTypeCode || item.type, false);
      if (!chamber || !type) {
        console.warn('Skipping committee', item.systemCode, ': missing chamber or type');
        continue;
      }
      const name = (item.name || '').trim() || systemCode;
      seen.add(systemCode);
      const isSubcommittee = systemCode.slice(-2) !== '00';
      const committeeType = isSubcommittee ? 'Subcommittee' : type;
      if (!committeeType) {
        console.warn('Skipping committee', item.systemCode, ': missing type');
        continue;
      }
      const entityId = await ensureCommitteeEntity(supabase, systemCode, name);
      const row = {
        system_code: systemCode,
        name,
        chamber,
        committee_type: committeeType,
        is_active: true,
        update_date: null,
        source: 'congress_gov',
        source_payload: item,
        updated_at: new Date().toISOString(),
        entity_id: entityId,
      };
      const { error } = await supabase.from('committees').upsert(row, { onConflict: 'system_code' });
      if (error) {
        console.warn('Sync failed for', systemCode, error.message);
        errors++;
      } else {
        synced++;
      }

      const subcommittees = item.subcommittees || [];
      for (const sub of subcommittees) {
        const subCode = normalizeSystemCode(sub.systemCode);
        if (!subCode || seen.has(subCode)) continue;
        seen.add(subCode);
        const subName = (sub.name || '').trim() || subCode;
        const subIsSub = subCode.slice(-2) !== '00';
        const subEntityId = await ensureCommitteeEntity(supabase, subCode, subName);
        const subRow = {
          system_code: subCode,
          name: subName,
          chamber,
          committee_type: subIsSub ? 'Subcommittee' : (normalizeType(sub.committeeTypeCode || sub.type, false) || 'Subcommittee'),
          is_active: true,
          update_date: null,
          source: 'congress_gov',
          source_payload: sub,
          updated_at: new Date().toISOString(),
          entity_id: subEntityId,
        };
        const { error: subErr } = await supabase.from('committees').upsert(subRow, { onConflict: 'system_code' });
        if (subErr) {
          console.warn('Sync failed for subcommittee', subCode, subErr.message);
          errors++;
        } else {
          synced++;
        }
      }
    }

    if (committees.length < COMMITTEE_PAGE_SIZE) break;
    offset += COMMITTEE_PAGE_SIZE;
  }

  console.log('Committee sync complete: congress=%s synced=%s errors=%s', congress, synced, errors);
  return { congress, synced, errors };
}

run()
  .then((out) => {
    console.log(JSON.stringify(out, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
