/**
 * One-off: run Alpha Galangal Committee formula for ticker SMCI.
 * Read-only: fetches prompt from DB, calls Gemini, prints result. No DB writes.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.development' });
config({ path: '.env' });

const TICKER = 'SMCI';
const API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!API_KEY) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Supabase env not set');
  process.exit(1);
}

const factorBundle = {
  ticker: TICKER,
  note: 'No entity factor data in database for this ticker; use public knowledge for Super Micro Computer Inc.',
  source: 'run-committee-smci-script',
};

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);
  let activePromptId: string | null = null;
  for (const k of ['llm', 'alpha_galangal_committee_llm'] as const) {
    const { data: row } = await supabase
      .from('formulas')
      .select('active_prompt_version_id')
      .eq('key', k)
      .maybeSingle();
    if (row?.active_prompt_version_id) {
      activePromptId = String(row.active_prompt_version_id);
      break;
    }
  }
  if (!activePromptId) {
    console.error('Alpha Galangal Committee formula has no active prompt');
    process.exit(1);
  }
  const { data: prompt, error: promptErr } = await supabase
    .from('prompt_versions')
    .select('system_prompt, user_prompt_template, model_name, temperature, max_output_tokens')
    .eq('id', activePromptId)
    .single();
  if (promptErr || !prompt) {
    console.error('Prompt fetch failed:', promptErr?.message);
    process.exit(1);
  }

  const userText = (prompt.user_prompt_template || '')
    .replace(/\{\{ticker\}\}/g, TICKER)
    .replace(/\{\{factor_bundle_json\}\}/g, JSON.stringify(factorBundle, null, 2));

  const modelId = (prompt.model_name || 'gemini-2.5-flash').startsWith('models/') ? prompt.model_name : `models/${prompt.model_name}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${API_KEY}`;
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: prompt.temperature ?? 0.2,
      maxOutputTokens: Math.max(prompt.max_output_tokens ?? 800, 4096),
      responseMimeType: 'application/json',
    },
  };
  if (prompt.system_prompt) {
    body.systemInstruction = { parts: [{ text: prompt.system_prompt }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Gemini API error:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: { text?: string }) => p?.text ?? '').join('');
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (!text) {
    console.error('No text in Gemini response. finishReason:', finishReason);
    process.exit(1);
  }
  if (finishReason === 'MAX_TOKENS') {
    console.error('Warning: response truncated (MAX_TOKENS). Length:', text.length);
  }

  let raw = text.trim();
  const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (codeBlock) raw = codeBlock[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { raw: text };
  }
  console.log('--- Alpha Galangal Committee result for', TICKER, '---\n');
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
