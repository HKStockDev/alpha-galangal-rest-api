import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DataSyncJobKey, DataSyncLastRun } from '../data-sync/data-sync.types';
import { loadSyncEnv } from './load-env';

export type DataSyncRunSource = 'trigger.dev' | 'nest-scheduler';

export interface UpsertDataSyncJobLastRunInput {
  jobKey: DataSyncJobKey;
  ok: boolean;
  summary?: string;
  runId?: string;
  source: DataSyncRunSource;
  triggerStatus?: string;
  running?: boolean;
  finishedAt?: string;
}

let adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient | null {
  loadSyncEnv();
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  if (!adminClient) {
    adminClient = createClient(url, key);
  }
  return adminClient;
}

export async function upsertDataSyncJobLastRun(
  input: UpsertDataSyncJobLastRunInput,
): Promise<void> {
  const client = getAdminClient();
  if (!client) return;

  const finishedAt = input.finishedAt ?? new Date().toISOString();
  const { error } = await client.from('data_sync_job_last_runs').upsert(
    {
      job_key: input.jobKey,
      finished_at: finishedAt,
      ok: input.ok,
      summary: input.summary ?? null,
      run_id: input.runId ?? null,
      source: input.source,
      trigger_status: input.triggerStatus ?? null,
      running: input.running ?? false,
      updated_at: finishedAt,
    },
    { onConflict: 'job_key' },
  );

  if (error) {
    console.warn(
      `[data-sync-run-store] Failed to upsert ${input.jobKey}: ${error.message}`,
    );
  }
}

export async function loadDataSyncJobLastRuns(): Promise<
  Partial<Record<DataSyncJobKey, DataSyncLastRun>>
> {
  const client = getAdminClient();
  if (!client) return {};

  const { data, error } = await client
    .from('data_sync_job_last_runs')
    .select(
      'job_key, finished_at, ok, summary, run_id, source, trigger_status, running',
    );

  if (error) {
    console.warn(`[data-sync-run-store] Failed to load last runs: ${error.message}`);
    return {};
  }

  const result: Partial<Record<DataSyncJobKey, DataSyncLastRun>> = {};
  for (const row of data ?? []) {
    const jobKey = row.job_key as DataSyncJobKey;
    result[jobKey] = {
      at: row.finished_at as string,
      ok: Boolean(row.ok),
      summary: (row.summary as string | null) ?? undefined,
      runId: (row.run_id as string | null) ?? undefined,
      source: (row.source as DataSyncRunSource) ?? undefined,
      triggerStatus: (row.trigger_status as string | null) ?? undefined,
      running: Boolean(row.running),
    };
  }
  return result;
}
