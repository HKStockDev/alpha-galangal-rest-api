/**
 * CLI mirror of POST /congress/sync-committee-memberships (CommitteeMembershipSyncService).
 * Prefer the API + DATA_SYNC_CRON_COMMITTEE_MEMBERSHIPS for production.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });

const YAML_URL = 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml';
const CONGRESS_TERM_START_YEAR = 1789;

function getCurrentCongress() {
  const year = new Date().getFullYear();
  return Math.floor((year - CONGRESS_TERM_START_YEAR) / 2) + 1;
}

function normalizeCommitteeCode(code) {
  if (!code || typeof code !== 'string') return null;
  let lower = code.trim().toLowerCase();
  if (/^(hs|ss|js)[a-z0-9]{2,10}[0-9]{2}$/.test(lower)) return lower;
  if (/^(hs|ss|js)[a-z]{2,8}$/.test(lower)) return lower + '00';
  return null;
}

function committeeCodeForDb(normalizedCode, validCodes) {
  if (!normalizedCode || !validCodes.has(normalizedCode)) {
    const prefix = normalizedCode?.slice(0, 2);
    const rest = normalizedCode?.slice(2);
    const alternate = prefix && rest ? prefix + prefix.charAt(1) + rest : null;
    if (alternate && validCodes.has(alternate)) return alternate;
  }
  return normalizedCode;
}

function mapTitleToRole(title) {
  if (!title || typeof title !== 'string') return 'member';
  const t = title.toLowerCase();
  if (t.includes('chair') && !t.includes('ranking') && !t.includes('vice')) return 'chair';
  if (t.includes('ranking member')) return 'ranking_member';
  if (t.includes('vice chair') || t.includes('vice chairman')) return 'vice_chair';
  if (t.includes('ex officio')) return 'ex_officio';
  if (t.includes('cochairman') || t.includes('co-chairman')) return 'chair';
  return 'member';
}

async function fetchYaml() {
  const res = await fetch(YAML_URL);
  if (!res.ok) throw new Error(`Failed to fetch committee membership YAML: ${res.status}`);
  return res.text();
}

async function run() {
  const yaml = require('js-yaml');
  const { createClient } = require('@supabase/supabase-js');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY required');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const congress = getCurrentCongress();
  const text = await fetchYaml();
  const parsed = yaml.load(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid committee membership YAML');

  const { data: existingCommittees } = await supabase.from('committees').select('system_code');
  const validCodes = new Set((existingCommittees || []).map((r) => r.system_code));
  let skippedNoCode = 0;
  let skippedInvalidCode = 0;

  const rows = [];
  for (const [code, list] of Object.entries(parsed)) {
    if (!Array.isArray(list)) continue;
    const systemCode = normalizeCommitteeCode(code);
    if (!systemCode) {
      skippedNoCode++;
      continue;
    }
    const dbCode = committeeCodeForDb(systemCode, validCodes);
    if (!dbCode) {
      skippedInvalidCode++;
      continue;
    }
    for (const m of list) {
      if (!m || typeof m !== 'object' || !m.bioguide) continue;
      const bioguide = String(m.bioguide).trim();
      if (!bioguide) continue;
      const role = mapTitleToRole(m.title);
      const memberRank = typeof m.rank === 'number' && m.rank >= 1 ? m.rank : null;
      const committeeParty =
        m.party === 'majority' || m.party === 'minority' ? m.party : null;
      rows.push({
        bioguide_id: bioguide,
        committee_system_code: dbCode,
        congress,
        role,
        member_rank: memberRank,
        committee_party: committeeParty,
        source: 'congress_legislators_yaml',
      });
    }
  }

  if (rows.length === 0 && (skippedNoCode > 0 || skippedInvalidCode > 0)) {
    const sampleYaml = Object.keys(parsed).slice(0, 5).map((k) => ({ key: k, normalized: normalizeCommitteeCode(k) }));
    const sampleValid = [...validCodes].slice(0, 10).sort();
    console.warn('Committee membership sync: no rows produced. Sample YAML keys (normalized):', JSON.stringify(sampleYaml));
    console.warn('Sample DB committee codes:', sampleValid);
    console.warn('Skipped: no normalized code=%s, code not in DB=%s', skippedNoCode, skippedInvalidCode);
  }

  const membershipKey = (r) => `${r.bioguide_id}|${r.committee_system_code}`;
  const validRows = rows.filter((r) => validCodes.has(r.committee_system_code));
  if (validRows.length < rows.length) {
    console.warn('Dropped %s rows with committee_system_code not in committees', rows.length - validRows.length);
  }

  const bioguideIds = [...new Set(validRows.map((r) => r.bioguide_id))];
  const politicianIdByBioguide = new Map();
  if (bioguideIds.length > 0) {
    const { data: politicians } = await supabase
      .from('politicians')
      .select('id, bioguide_id')
      .in('bioguide_id', bioguideIds);
    for (const p of politicians || []) {
      if (p.bioguide_id) politicianIdByBioguide.set(p.bioguide_id, p.id);
    }
  }
  const rowsWithPolitician = validRows.filter((r) => {
    const pid = politicianIdByBioguide.get(r.bioguide_id);
    if (pid) {
      r.politician_id = pid;
      return true;
    }
    return false;
  });
  if (rowsWithPolitician.length < validRows.length) {
    console.warn('Skipped %s rows with bioguide_id not in politicians', validRows.length - rowsWithPolitician.length);
  }

  if (rowsWithPolitician.length > 0) {
    let { error: upsertErr } = await supabase
      .from('politician_committee_memberships')
      .upsert(rowsWithPolitician, { onConflict: 'bioguide_id,committee_system_code,congress' });
    if (upsertErr && upsertErr.message && upsertErr.message.includes('committee_party')) {
      const rowsWithoutParty = rowsWithPolitician.map(({ committee_party: _, ...r }) => r);
      upsertErr = (await supabase
        .from('politician_committee_memberships')
        .upsert(rowsWithoutParty, { onConflict: 'bioguide_id,committee_system_code,congress' })).error;
    }
    if (upsertErr) throw new Error(`Upsert memberships failed: ${upsertErr.message}`);
  }

  const currentKeys = new Set(validRows.map(membershipKey));
  const { data: existingForCongress } = await supabase
    .from('politician_committee_memberships')
    .select('id, bioguide_id, committee_system_code')
    .eq('congress', congress);
  const toDeleteIds = (existingForCongress || []).filter(
    (e) => !currentKeys.has(membershipKey(e))
  ).map((e) => e.id);
  if (toDeleteIds.length > 0) {
    const { error: delErr } = await supabase
      .from('politician_committee_memberships')
      .delete()
      .in('id', toDeleteIds);
    if (delErr) throw new Error(`Delete stale memberships failed: ${delErr.message}`);
  }

  console.log('Committee membership sync complete: congress=%s upserted=%s removed=%s', congress, rowsWithPolitician.length, toDeleteIds.length);
  return { congress, upserted: rowsWithPolitician.length, removed: toDeleteIds.length };
}

run()
  .then((out) => {
    console.log(JSON.stringify(out, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
