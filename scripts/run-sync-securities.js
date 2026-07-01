/**
 * Run a scheduled sync for securities: open jobs count or employee count estimate.
 * Uses prompts (open_jobs_extraction / employee_count_estimate_extraction) and writes to entity_factor_values_ts.
 * Evidence is stub (empty) until you plug a real evidence source.
 *
 * Usage: node scripts/run-sync-securities.js <open_jobs|employee_count> [--limit=N] [--dry-run] [--delay=500]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const SYNC_REGISTRY = {
  open_jobs: {
    factorKey: 'open_jobs_count',
    promptKey: 'open_jobs_extraction',
  },
  employee_count: {
    factorKey: 'employee_count_estimate',
    promptKey: 'employee_count_estimate_extraction',
  },
  jobs_per_100: {
    factorKey: 'jobs_per_100_employees',
    promptKey: null,
  },
};

function fillTemplate(template, vars) {
  let out = String(template ?? '');
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), (v ?? '').toString());
  }
  return out;
}

async function getEvidence(supabase, entityId, syncType, security) {
  if (syncType === 'employee_count' && security?.total_employees != null) {
    const n = Number(security.total_employees);
    if (Number.isFinite(n)) return `Company: ${security.name || 'Unknown'}. total_employees (from data): ${n}.`;
  }
  if (syncType === 'open_jobs') {
    const parts = [];
    if (security?.name) parts.push(`Company: ${security.name}`);
    if (security?.ticker) parts.push(`Ticker: ${security.ticker}`);
    if (security?.homepage_url) parts.push(`Homepage: ${security.homepage_url}`);
    if (parts.length) return parts.join('\n') + '\n\nUse your knowledge to estimate current open job postings for this company. If uncertain, give your best estimate or 0.';
  }
  return '';
}

async function loadActivePromptVersion(supabase, promptKey) {
  const { data: prompt, error: pErr } = await supabase
    .from('prompts')
    .select('active_prompt_version_id')
    .eq('key', promptKey)
    .single();
  if (pErr || !prompt?.active_prompt_version_id) return null;
  const { data: pv, error: pvErr } = await supabase
    .from('prompt_versions')
    .select('system_prompt, user_prompt_template, model_name, temperature, max_output_tokens')
    .eq('id', prompt.active_prompt_version_id)
    .single();
  if (pvErr || !pv) return null;
  return pv;
}

async function callGemini(apiKey, promptVersion, templateVars) {
  const userText = fillTemplate(promptVersion.user_prompt_template ?? '', templateVars);
  const systemText = promptVersion.system_prompt ?? '';
  const model = (promptVersion.model_name ?? 'gemini-2.0-flash').startsWith('models/')
    ? promptVersion.model_name
    : `models/${promptVersion.model_name ?? 'gemini-2.0-flash'}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: promptVersion.temperature ?? 0.1,
      maxOutputTokens: promptVersion.max_output_tokens ?? 1024,
      responseMimeType: 'application/json',
    },
  };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data?.error?.message) || data?.message || res.statusText);
  const parts = (data?.candidates || [])[0]?.content?.parts || [];
  const text = parts.map((p) => p?.text ?? '').join('').trim();
  if (!text) return { rows: [] };
  let raw = text.trim();
  const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (codeBlock) raw = codeBlock[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { rows: [] };
  }
}

function rowToUpsert(r) {
  return {
    entity_id: r.entity_id,
    factor_id: r.factor_id,
    value_num: r.value_num != null ? Number(r.value_num) : null,
    value_text: r.value_text ?? null,
    unit: r.unit ?? null,
    currency: r.currency ?? null,
    period_key: r.period_key ?? 'instant',
    fiscal_year: r.fiscal_year ?? null,
    fiscal_period: r.fiscal_period ?? null,
    start_date: r.start_date ?? null,
    end_date: r.end_date ?? null,
    period_of_report_date: r.period_of_report_date ?? null,
    source: r.source ?? 'derived',
    ingested_at: r.ingested_at ?? new Date().toISOString(),
    model_version: r.model_version ?? 'v1',
    period_months: r.period_months ?? null,
    as_of_date: r.as_of_date ?? r.end_date ?? null,
  };
}

function rowToSnapshot(r) {
  return {
    entity_id: r.entity_id,
    factor_id: r.factor_id,
    value_num: r.value_num != null ? Number(r.value_num) : null,
    source: r.source ?? 'derived',
    ingested_at: r.ingested_at ?? new Date().toISOString(),
    model_version: r.model_version ?? 'v1',
    period_key: r.period_key ?? 'instant',
    period_months: r.period_months ?? null,
  };
}

async function runDerivedJobsPer100(supabase, dryRun) {
  const { data: factor, error: factorErr } = await supabase
    .from('factors')
    .select('id')
    .eq('key', 'jobs_per_100_employees')
    .single();
  if (factorErr || !factor?.id) {
    console.error('Factor jobs_per_100_employees not found');
    process.exit(1);
  }
  const openJobsFactor = await supabase.from('factors').select('id').eq('key', 'open_jobs_count').single();
  const empFactor = await supabase.from('factors').select('id').eq('key', 'employee_count_estimate').single();
  if (!openJobsFactor?.data?.id || !empFactor?.data?.id) {
    console.error('Missing open_jobs_count or employee_count_estimate factor');
    process.exit(1);
  }
  const oid = openJobsFactor.data.id;
  const eid = empFactor.data.id;
  const { data: openRows } = await supabase
    .from('entity_factor_values')
    .select('entity_id, value_num')
    .eq('factor_id', oid)
    .eq('period_key', 'instant');
  const { data: empRows } = await supabase
    .from('entity_factor_values')
    .select('entity_id, value_num')
    .eq('factor_id', eid)
    .eq('period_key', 'instant');
  const byEntity = new Map();
  for (const r of openRows || []) byEntity.set(r.entity_id, { open_jobs: r.value_num });
  for (const r of empRows || []) {
    const cur = byEntity.get(r.entity_id) || {};
    cur.employee_count = r.value_num;
    byEntity.set(r.entity_id, cur);
  }
  const asOfDate = new Date().toISOString().slice(0, 10);
  const ingestedAt = new Date().toISOString();
  const toUpsertTs = [];
  const toUpsertSnap = [];
  for (const [entityId, v] of byEntity) {
    const open = v.open_jobs != null ? Number(v.open_jobs) : null;
    const emp = v.employee_count != null ? Number(v.employee_count) : null;
    if (open == null || emp == null || emp === 0 || !Number.isFinite(open) || !Number.isFinite(emp)) continue;
    const valueNum = (open / emp) * 100;
    if (!Number.isFinite(valueNum)) continue;
    toUpsertTs.push({
      entity_id: entityId,
      factor_id: factor.id,
      value_num: valueNum,
      value_text: null,
      unit: null,
      currency: null,
      period_key: 'instant',
      fiscal_year: null,
      fiscal_period: null,
      start_date: null,
      end_date: asOfDate,
      period_of_report_date: null,
      source: 'derived',
      ingested_at: ingestedAt,
      model_version: 'v1',
      period_months: null,
      as_of_date: asOfDate,
    });
    toUpsertSnap.push({
      entity_id: entityId,
      factor_id: factor.id,
      value_num: valueNum,
      source: 'derived',
      ingested_at: ingestedAt,
      model_version: 'v1',
      period_key: 'instant',
      period_months: null,
    });
  }
  if (!dryRun && toUpsertTs.length > 0) {
    const { error: tsErr } = await supabase
      .from('entity_factor_values_ts')
      .upsert(toUpsertTs, { onConflict: 'entity_id,factor_id,model_version,period_key,as_of_date' });
    if (tsErr) throw new Error(tsErr.message);
    const { error: snapErr } = await supabase
      .from('entity_factor_values')
      .upsert(toUpsertSnap, { onConflict: 'entity_id,factor_id,model_version,period_key' });
    if (snapErr) throw new Error(snapErr.message);
  }
  console.log(`Done: jobs_per_100_employees computed=${toUpsertTs.length} dryRun=${dryRun}`);
  return { syncType: 'jobs_per_100', computed: toUpsertTs.length, dryRun };
}

async function run() {
  const syncType = process.argv[2];
  if (!syncType || !SYNC_REGISTRY[syncType]) {
    console.error('Usage: node scripts/run-sync-securities.js <open_jobs|employee_count|jobs_per_100> [--limit=N] [--dry-run] [--delay=500]');
    process.exit(1);
  }
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
  const dryRun = process.argv.includes('--dry-run');
  const delayArg = process.argv.find((a) => a.startsWith('--delay='));
  const delayMs = delayArg ? parseInt(delayArg.split('=')[1], 10) : 500;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY required');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (syncType === 'jobs_per_100') {
    return runDerivedJobsPer100(supabase, dryRun);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }

  const { factorKey, promptKey } = SYNC_REGISTRY[syncType];
  const { data: factor, error: factorErr } = await supabase
    .from('factors')
    .select('id')
    .eq('key', factorKey)
    .single();
  if (factorErr || !factor?.id) {
    console.error(`Factor not found: ${factorKey}`);
    process.exit(1);
  }
  const factorId = factor.id;

  const promptVersion = await loadActivePromptVersion(supabase, promptKey);
  if (!promptVersion) {
    console.error(`Active prompt version not found for: ${promptKey}`);
    process.exit(1);
  }

  let { data: securities, error: secErr } = await supabase
    .from('securities')
    .select('id, entity_id, ticker, name, total_employees, homepage_url')
    .not('entity_id', 'is', null)
    .eq('active', true)
    .order('ticker');
  if (secErr) {
    console.error('Failed to fetch securities:', secErr.message);
    process.exit(1);
  }
  securities = securities || [];
  if (limit != null && limit > 0) securities = securities.slice(0, limit);

  console.log(`Sync: ${syncType} | securities: ${securities.length} | dryRun: ${dryRun}`);

  const asOfDate = new Date().toISOString().slice(0, 10);
  let processed = 0;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < securities.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const sec = securities[i];
    const entityId = sec.entity_id;
    try {
      const evidence = await getEvidence(supabase, entityId, syncType, sec);
      const userVars = {
        entity_id: entityId,
        factor_id: factorId,
        as_of_date: asOfDate,
        evidence: evidence || '(no evidence provided)',
      };
      const out = await callGemini(apiKey, promptVersion, userVars);
      const rows = Array.isArray(out?.rows) ? out.rows : [];
      processed++;
      if (rows.length === 0) continue;
      const toUpsert = rows.map(rowToUpsert).filter((r) => r.entity_id && r.factor_id && r.as_of_date);
      if (toUpsert.length === 0) continue;
      if (!dryRun) {
        const { error: tsErr } = await supabase
          .from('entity_factor_values_ts')
          .upsert(toUpsert, { onConflict: 'entity_id,factor_id,model_version,period_key,as_of_date' });
        if (tsErr) throw new Error(tsErr.message);
        const snapshotRows = toUpsert.map(rowToSnapshot);
        const { error: snapErr } = await supabase
          .from('entity_factor_values')
          .upsert(snapshotRows, { onConflict: 'entity_id,factor_id,model_version,period_key' });
        if (snapErr) throw new Error(snapErr.message);
      }
      inserted += toUpsert.length;
    } catch (e) {
      errors++;
      console.warn(`[${sec.ticker}] ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`Done: processed=${processed} inserted=${inserted} errors=${errors}`);
  return { syncType, processed, inserted, errors, dryRun };
}

run()
  .then((out) => console.log(JSON.stringify(out, null, 2)))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
