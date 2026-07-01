const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });

const CONGRESS_TERM_START_YEAR = 1789;
const MEMBER_PAGE_SIZE = 250;
const DELAY_MS_BETWEEN_DETAIL_CALLS = 250;
const ENTITY_TYPE_POLITICIAN = 'politician';

function getCurrentCongress() {
  const year = new Date().getFullYear();
  return Math.floor((year - CONGRESS_TERM_START_YEAR) / 2) + 1;
}

function congressToYears(congress) {
  const startYear = CONGRESS_TERM_START_YEAR + 2 * (congress - 1);
  return { startYear, endYear: startYear + 1 };
}

function buildNameFull(m) {
  if (m.name && String(m.name).trim()) return String(m.name).trim();
  const parts = [m.firstName, m.middleName, m.lastName, m.suffix ? String(m.suffix).replace(/^,?\s*/, '') : null].filter(Boolean);
  return parts.length ? parts.join(' ').trim() : null;
}

function buildNameLastFirst(m) {
  const last = m.lastName ?? '';
  const first = [m.firstName, m.middleName].filter(Boolean).join(' ');
  const suf = m.suffix ? `, ${m.suffix}` : '';
  if (!last && !first) return null;
  return `${last}, ${first}${suf}`.trim() || null;
}

function getTermsFromMember(member) {
  const terms =
    member.serviceTerms ??
    member.directorialTerms ??
    member.service_terms ??
    member.directorial_terms ??
    [];
  return Array.isArray(terms) ? terms : [];
}

function mapTermToRow(bioguideId, t) {
  const congress = Number(t.congress);
  const { startYear, endYear } = Number.isFinite(congress) && congress > 0
    ? congressToYears(congress)
    : { startYear: t.startYear ?? 0, endYear: t.endYear ?? 0 };
  return {
    bioguide_id: bioguideId,
    congress: Number.isFinite(congress) ? congress : 0,
    chamber: t.chamber ? String(t.chamber) : null,
    member_type: t.type ? String(t.type) : null,
    state_code: (t.stateCode ?? t.state) ? String(t.stateCode ?? t.state) : null,
    state_name: t.state ? String(t.state) : null,
    district: t.district != null ? String(t.district) : null,
    party: t.party ? String(t.party) : null,
    party_code: t.partyCode ? String(t.partyCode) : null,
    start_year: startYear,
    end_year: endYear,
  };
}

async function fetchMemberList(congress, offset = 0) {
  const apiKey = process.env.CONGRESS_GOV_API_KEY;
  if (!apiKey) throw new Error('CONGRESS_GOV_API_KEY not set');
  const url = new URL('https://api.congress.gov/v3/member');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('congress', String(congress));
  url.searchParams.set('limit', String(MEMBER_PAGE_SIZE));
  url.searchParams.set('offset', String(offset));
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Congress API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchMemberDetail(bioguideId) {
  const apiKey = process.env.CONGRESS_GOV_API_KEY;
  if (!apiKey) throw new Error('CONGRESS_GOV_API_KEY not set');
  const id = encodeURIComponent(bioguideId);
  const url = new URL(`https://api.congress.gov/v3/member/${id}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('fields', 'serviceTerms,directorialTerms');
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Congress API ${res.status}: ${await res.text()}`);
  return res.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureEntity(supabase, bioguideId, name) {
  const key = bioguideId;
  const { data: existing } = await supabase
    .from('entities')
    .select('id')
    .eq('entity_type', ENTITY_TYPE_POLITICIAN)
    .eq('key', key)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: inserted, error } = await supabase
    .from('entities')
    .insert({ entity_type: ENTITY_TYPE_POLITICIAN, key, name })
    .select('id')
    .single();
  if (error) throw new Error(`Entity insert failed: ${error.message}`);
  return inserted.id;
}

async function upsertPolitician(supabase, member, entityId, isCurrentMember) {
  const bioguideId = member.bioguideId ?? null;
  if (!bioguideId) return;
  const nameFull = buildNameFull(member) ?? '';
  const terms0 = getTermsFromMember(member)[0];
  const contact = member.contact;
  const contactAddress = Array.isArray(contact?.address)
    ? contact.address.join('; ')
    : Array.isArray(contact)
      ? contact.join('; ')
      : typeof contact === 'string'
        ? contact
        : null;
  const contactPhone = contact && typeof contact === 'object' && 'phone' in contact
    ? String(contact.phone ?? '')
    : null;

  const row = {
    entity_id: entityId,
    bioguide_id: bioguideId,
    first_name: member.firstName ? String(member.firstName) : null,
    middle_name: member.middleName ? String(member.middleName) : null,
    last_name: member.lastName ? String(member.lastName) : null,
    suffix: member.suffix ? String(member.suffix) : null,
    nickname: member.nickname ? String(member.nickname) : null,
    name_full: nameFull || null,
    name_last_first: buildNameLastFirst(member),
    is_current_member: isCurrentMember,
    current_party: terms0?.party ? String(terms0.party) : null,
    current_state: terms0?.state ? String(terms0.state ?? '') : null,
    current_district: terms0?.district != null ? String(terms0.district) : null,
    chamber: terms0?.chamber ? String(terms0.chamber) : null,
    official_website_url: member.officialWebsiteUrl ? String(member.officialWebsiteUrl) : null,
    updated_at_congress_gov: new Date().toISOString(),
    birth_year: member.birthYear != null ? Number(member.birthYear) : null,
    death_year: member.deathYear != null ? Number(member.deathYear) : null,
    honorific_name: member.honorificName ? String(member.honorificName) : null,
    portrait_url: member.portrait ? String(member.portrait) : null,
    portrait_source: null,
    contact_address: contactAddress || null,
    contact_phone: contactPhone || null,
    source: 'congress_gov',
  };

  const { error } = await supabase.from('politicians').upsert(row, { onConflict: 'bioguide_id' });
  if (error) throw new Error(`Politician upsert failed for ${bioguideId}: ${error.message}`);
}

function termKey(r) {
  return `${r.congress}|${r.chamber ?? ''}|${r.start_year}|${r.end_year}`;
}

function termEqual(a, b) {
  return (
    a.congress === b.congress &&
    (a.chamber ?? '') === (b.chamber ?? '') &&
    (a.member_type ?? '') === (b.member_type ?? '') &&
    (a.state_code ?? '') === (b.state_code ?? '') &&
    (a.state_name ?? '') === (b.state_name ?? '') &&
    (a.district ?? '') === (b.district ?? '') &&
    (a.party ?? '') === (b.party ?? '') &&
    (a.party_code ?? '') === (b.party_code ?? '') &&
    a.start_year === b.start_year &&
    a.end_year === b.end_year
  );
}

async function upsertPoliticianTerms(supabase, member) {
  const bioguideId = member.bioguideId ?? null;
  if (!bioguideId) return;
  const terms = getTermsFromMember(member);
  const apiRows = terms
    .filter((t) => t.congress != null || (t.startYear != null && t.endYear != null))
    .map((t) => mapTermToRow(bioguideId, t))
    .filter((r) => r.congress > 0 || r.start_year > 0);
  if (apiRows.length === 0) return;

  const { data: existing, error: fetchErr } = await supabase
    .from('politician_terms')
    .select('id, congress, chamber, member_type, state_code, state_name, district, party, party_code, start_year, end_year')
    .eq('bioguide_id', bioguideId);
  if (fetchErr) throw new Error(`Politician terms fetch failed for ${bioguideId}: ${fetchErr.message}`);
  const existingList = existing || [];

  const apiKeys = new Set(apiRows.map(termKey));
  const existingByKey = new Map();
  for (const e of existingList) {
    const k = termKey(e);
    if (!existingByKey.has(k)) existingByKey.set(k, e);
  }

  const toInsert = [];
  const toUpdate = [];
  const toDeleteIds = [];

  for (const row of apiRows) {
    const k = termKey(row);
    const existingRow = existingByKey.get(k);
    if (!existingRow) {
      toInsert.push(row);
    } else if (!termEqual(existingRow, row)) {
      toUpdate.push({ id: existingRow.id, ...row });
    }
  }
  for (const e of existingList) {
    if (!apiKeys.has(termKey(e))) toDeleteIds.push(e.id);
  }

  if (toDeleteIds.length > 0) {
    const { error: delErr } = await supabase.from('politician_terms').delete().in('id', toDeleteIds);
    if (delErr) throw new Error(`Politician terms delete failed for ${bioguideId}: ${delErr.message}`);
  }
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from('politician_terms').insert(toInsert);
    if (insErr) throw new Error(`Politician terms insert failed for ${bioguideId}: ${insErr.message}`);
  }
  for (const row of toUpdate) {
    const { id, ...payload } = row;
    const { error: upErr } = await supabase.from('politician_terms').update(payload).eq('id', id);
    if (upErr) throw new Error(`Politician terms update failed for ${bioguideId}: ${upErr.message}`);
  }
}

async function run() {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY required');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const congress = getCurrentCongress();
  let offset = 0;
  let synced = 0;
  let errors = 0;
  const seen = new Set();

  for (;;) {
    const list = await fetchMemberList(congress, offset);
    const members = list.members || [];
    if (members.length === 0) break;

    for (const m of members) {
      const bioguideId = m.bioguideId ?? null;
      if (!bioguideId || seen.has(bioguideId)) continue;
      seen.add(bioguideId);
      try {
        await delay(DELAY_MS_BETWEEN_DETAIL_CALLS);
        const detail = await fetchMemberDetail(bioguideId);
        const member = detail?.member ?? detail?.members?.[0];
        if (!member) {
          console.warn('No member in response for', bioguideId);
          continue;
        }
        if (!member.bioguideId) member.bioguideId = bioguideId;
        const nameFull = buildNameFull(member) || null;
        const entityId = await ensureEntity(supabase, bioguideId, nameFull);
        await upsertPolitician(supabase, member, entityId, true);
        await upsertPoliticianTerms(supabase, member);
        synced++;
      } catch (e) {
        console.warn('Sync failed for', bioguideId, e instanceof Error ? e.message : e);
        errors++;
      }
    }

    if (members.length < MEMBER_PAGE_SIZE) break;
    offset += MEMBER_PAGE_SIZE;
  }

  console.log('Member sync complete: congress=%s synced=%s errors=%s', congress, synced, errors);
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
