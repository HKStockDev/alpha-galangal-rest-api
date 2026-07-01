import type { DataSyncJobKey } from '../data-sync/data-sync.types';
import { formatSyncOutputSummary } from '../trigger/sync-output-summary';
import type { TriggerSyncTaskId } from '../trigger/trigger-task-ids';
import { upsertDataSyncJobLastRun } from './data-sync-run-store';

function syncOk(output: unknown): boolean {
  if (!output || typeof output !== 'object') return true;
  const o = output as Record<string, unknown>;
  if (Array.isArray(o.errors) && o.errors.length > 0) return false;
  if (typeof o.errors === 'number' && o.errors > 0) return false;
  if (typeof o.failed === 'number' && o.failed > 0) return false;
  return true;
}

export async function withRecordedDataSyncRun<T>(
  jobKey: DataSyncJobKey,
  taskId: TriggerSyncTaskId,
  fn: () => Promise<T>,
  options?: { runId?: string },
): Promise<T> {
  try {
    const output = await fn();
    await upsertDataSyncJobLastRun({
      jobKey,
      ok: syncOk(output),
      summary: formatSyncOutputSummary(taskId, output),
      source: 'trigger.dev',
      runId: options?.runId,
      triggerStatus: 'COMPLETED',
    });
    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await upsertDataSyncJobLastRun({
      jobKey,
      ok: false,
      summary: msg,
      source: 'trigger.dev',
      runId: options?.runId,
      triggerStatus: 'FAILED',
    });
    throw err;
  }
}
