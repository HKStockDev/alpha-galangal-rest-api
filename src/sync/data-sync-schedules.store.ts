import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DataSyncJobKey, DataSyncJobSchedule } from '../data-sync/data-sync.types';
import { DATA_SYNC_JOB_KEYS } from '../data-sync/data-sync.types';
import { loadSyncEnv } from '../sync/load-env';

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

function mapRow(row: Record<string, unknown>): DataSyncJobSchedule {
  return {
    job_key: row.job_key as DataSyncJobKey,
    enabled: Boolean(row.enabled),
    frequency: row.frequency as DataSyncJobSchedule['frequency'],
    timezone: String(row.timezone ?? 'America/New_York'),
    hourly_interval_hours:
      row.hourly_interval_hours != null ? Number(row.hourly_interval_hours) : null,
    hourly_start_time: (row.hourly_start_time as string | null) ?? null,
    market_days_only: Boolean(row.market_days_only),
    daily_time: (row.daily_time as string | null) ?? null,
    weekly_day_of_week:
      row.weekly_day_of_week != null ? Number(row.weekly_day_of_week) : null,
    weekly_time: (row.weekly_time as string | null) ?? null,
    monthly_day_of_month:
      row.monthly_day_of_month != null ? Number(row.monthly_day_of_month) : null,
    monthly_time: (row.monthly_time as string | null) ?? null,
    run_next_market_day_if_closed: Boolean(row.run_next_market_day_if_closed),
    updated_at: String(row.updated_at),
    updated_by_user_id: (row.updated_by_user_id as string | null) ?? null,
  };
}

export async function loadDataSyncJobSchedules(): Promise<
  Partial<Record<DataSyncJobKey, DataSyncJobSchedule>>
> {
  const client = getAdminClient();
  if (!client) return {};

  const { data, error } = await client.from('data_sync_job_schedules').select('*');
  if (error) {
    console.warn(`[data-sync-schedules-store] load failed: ${error.message}`);
    return {};
  }

  const result: Partial<Record<DataSyncJobKey, DataSyncJobSchedule>> = {};
  for (const row of data ?? []) {
    const schedule = mapRow(row as Record<string, unknown>);
    result[schedule.job_key] = schedule;
  }
  return result;
}

export async function loadDataSyncJobSchedule(
  jobKey: DataSyncJobKey,
): Promise<DataSyncJobSchedule | null> {
  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from('data_sync_job_schedules')
    .select('*')
    .eq('job_key', jobKey)
    .maybeSingle();
  if (error) {
    console.warn(`[data-sync-schedules-store] load ${jobKey} failed: ${error.message}`);
    return null;
  }
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export type UpdateDataSyncJobScheduleInput = Omit<
  DataSyncJobSchedule,
  'job_key' | 'updated_at' | 'updated_by_user_id'
> & {
  updated_by_user_id?: string | null;
};

export async function updateDataSyncJobSchedule(
  jobKey: DataSyncJobKey,
  input: UpdateDataSyncJobScheduleInput,
): Promise<DataSyncJobSchedule | null> {
  const client = getAdminClient();
  if (!client) return null;

  const now = new Date().toISOString();
  const row = {
    job_key: jobKey,
    enabled: input.enabled,
    frequency: input.frequency,
    timezone: input.timezone ?? 'America/New_York',
    hourly_interval_hours: input.hourly_interval_hours,
    hourly_start_time: input.hourly_start_time,
    market_days_only: input.market_days_only,
    daily_time: input.daily_time,
    weekly_day_of_week: input.weekly_day_of_week,
    weekly_time: input.weekly_time,
    monthly_day_of_month: input.monthly_day_of_month,
    monthly_time: input.monthly_time,
    run_next_market_day_if_closed: input.run_next_market_day_if_closed,
    updated_at: now,
    updated_by_user_id: input.updated_by_user_id ?? null,
  };

  const { data, error } = await client
    .from('data_sync_job_schedules')
    .upsert(row, { onConflict: 'job_key' })
    .select('*')
    .single();
  if (error) {
    console.warn(`[data-sync-schedules-store] update ${jobKey} failed: ${error.message}`);
    return null;
  }
  return mapRow(data as Record<string, unknown>);
}

export function useDbSyncSchedules(): boolean {
  const raw = (process.env.USE_DB_SYNC_SCHEDULES ?? 'true').trim().toLowerCase();
  return raw !== 'false';
}

export { DATA_SYNC_JOB_KEYS };
