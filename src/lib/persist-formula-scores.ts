import type { SupabaseClient } from '@supabase/supabase-js';
import { expandFormulaKeyAliases } from './formula-key-aliases';

const BATCH = 75;

export async function persistEntityFormulaScores(
  client: SupabaseClient,
  formulaKey: string,
  rows: Array<{
    entity_id: string;
    score: number;
    rank?: number | null;
    explanation?: Record<string, unknown> | null;
  }>,
): Promise<void> {
  if (rows.length === 0) return;

  let formulaId: string | null = null;
  for (const key of expandFormulaKeyAliases(formulaKey)) {
    const { data } = await client.from('formulas').select('id').eq('key', key).maybeSingle();
    if (data?.id) {
      formulaId = String(data.id);
      break;
    }
  }
  if (!formulaId) return;

  const now = new Date().toISOString();
  const currentRows = rows.map((r) => ({
    entity_id: r.entity_id,
    formula_id: formulaId,
    score: r.score,
    rank: r.rank ?? null,
    explanation: r.explanation ?? null,
    updated_at: now,
  }));

  for (let i = 0; i < currentRows.length; i += BATCH) {
    const chunk = currentRows.slice(i, i + BATCH);
    const { error: curErr } = await client
      .from('entity_scores_current')
      .upsert(chunk, { onConflict: 'entity_id,formula_id' });
    if (curErr) {
      throw new Error(`entity_scores_current upsert failed: ${curErr.message}`);
    }
  }

  const histRows = rows.map((r) => ({
    entity_id: r.entity_id,
    formula_id: formulaId,
    score: r.score,
  }));
  for (let i = 0; i < histRows.length; i += BATCH) {
    const { error: histErr } = await client.from('entity_scores_history').insert(histRows.slice(i, i + BATCH));
    if (histErr) {
      throw new Error(`entity_scores_history insert failed: ${histErr.message}`);
    }
  }
}
