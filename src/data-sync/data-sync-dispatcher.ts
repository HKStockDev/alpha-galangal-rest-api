import type { DataSyncJobKey } from './data-sync.types';
import { DATA_SYNC_JOB_KEYS } from './data-sync.types';
import { shouldRunNow } from './schedule-evaluator';
import { loadDataSyncJobLastRuns, upsertDataSyncJobLastRun } from '../sync/data-sync-run-store';
import {
  loadDataSyncJobSchedules,
  useDbSyncSchedules,
} from '../sync/data-sync-schedules.store';
import { loadSyncEnv } from '../sync/load-env';
import {
  runCommitteeMemberships,
  runCongressMembers,
  runEquityExposures,
  runFormulaScoreSync,
  runFmpPoliticalFeedMissingSecurities,
  runFmpPoliticalTrades,
  runJobsFactorsSync,
  runTaxonomyCycleScores,
  runTaxonomyStructuralGrowthCagrScores,
} from '../sync/sync-runners';
import { withRecordedDataSyncRun } from '../sync/with-recorded-data-sync-run';
import {
  TRIGGER_SYNC_TASK_IDS,
  type TriggerSyncTaskId,
} from '../trigger/trigger-task-ids';
import type { FormulaScoreSyncJobKey } from '../formula-score-sync/formula-score-sync.registry';
import { isFormulaScoreSyncJobKey } from '../formula-score-sync/formula-score-sync.registry';

export interface DispatchDueJobsResult {
  dispatched: DataSyncJobKey[];
  skipped: DataSyncJobKey[];
  useDbSchedules: boolean;
}

async function triggerTask(taskId: TriggerSyncTaskId, payload: Record<string, unknown>) {
  const { tasks } = await import('@trigger.dev/sdk');
  return tasks.trigger(taskId, payload);
}

function useTriggerDispatch(): boolean {
  if ((process.env.SYNC_RUN_INLINE ?? '').trim().toLowerCase() === 'true') {
    return false;
  }
  // Nest API uses TRIGGER_SECRET_KEY. Trigger workers may also set it in project env,
  // or authenticate via TRIGGER_API_URL without the secret.
  if ((process.env.TRIGGER_SECRET_KEY ?? '').trim()) return true;
  if ((process.env.TRIGGER_API_URL ?? '').trim()) return true;
  return false;
}

async function markJobDispatched(jobKey: DataSyncJobKey, taskId: TriggerSyncTaskId): Promise<void> {
  const at = new Date().toISOString();
  await upsertDataSyncJobLastRun({
    jobKey,
    ok: false,
    running: true,
    summary: `Scheduled dispatch queued (${taskId})`,
    source: 'trigger.dev',
    finishedAt: at,
  });
}

async function dispatchJob(jobKey: DataSyncJobKey): Promise<void> {
  const taskId = TRIGGER_SYNC_TASK_IDS[jobKey as keyof typeof TRIGGER_SYNC_TASK_IDS];
  if (!taskId) {
    throw new Error(`No trigger task id for job ${jobKey}`);
  }

  if (useTriggerDispatch()) {
    const payload = jobDispatchPayload(jobKey);
    await markJobDispatched(jobKey, taskId);
    try {
      await triggerTask(taskId, payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await upsertDataSyncJobLastRun({
        jobKey,
        ok: false,
        running: false,
        summary: `Dispatch failed: ${msg}`,
        source: 'trigger.dev',
      });
      throw err;
    }
    return;
  }

  await withRecordedDataSyncRun(jobKey, taskId, () => runJobInline(jobKey), {
    runId: `nest-dispatcher-${Date.now()}`,
  });
}

function jobDispatchPayload(jobKey: DataSyncJobKey): Record<string, unknown> {
  switch (jobKey) {
    case 'fmpPoliticalTrades':
      return { backfillMissingSecurities: true };
    case 'fmpPoliticalFeedMissingSecurities':
      return { delayMs: 250, dryRun: false };
    case 'taxonomyCycleScores':
      return {
        delayMs: Number.parseInt(
          process.env.DATA_SYNC_TAXONOMY_CYCLE_SCORES_DELAY_MS ?? '1500',
          10,
        ),
      };
    case 'equityExposures':
      return {
        delayMs: Number.parseInt(process.env.DATA_SYNC_EQUITY_EXPOSURES_DELAY_MS ?? '400', 10),
      };
    default:
      return {};
  }
}

async function runJobInline(jobKey: DataSyncJobKey): Promise<unknown> {
  switch (jobKey) {
    case 'fmpPoliticalTrades':
      return runFmpPoliticalTrades({ backfillMissingSecurities: true });
    case 'fmpPoliticalFeedMissingSecurities':
      return runFmpPoliticalFeedMissingSecurities({ delayMs: 250, dryRun: false });
    case 'congressMembers':
      return runCongressMembers();
    case 'committeeMemberships':
      return runCommitteeMemberships();
    case 'taxonomyStructuralGrowthCagrScores':
      return runTaxonomyStructuralGrowthCagrScores();
    case 'taxonomyCycleScores':
      return runTaxonomyCycleScores({
        delayMs: Number.parseInt(
          process.env.DATA_SYNC_TAXONOMY_CYCLE_SCORES_DELAY_MS ?? '1500',
          10,
        ),
      });
    case 'equityExposures':
      return runEquityExposures({
        delayMs: Number.parseInt(process.env.DATA_SYNC_EQUITY_EXPOSURES_DELAY_MS ?? '400', 10),
      });
    case 'jobsFactorsSync':
      return runJobsFactorsSync();
    default:
      if (isFormulaScoreSyncJobKey(jobKey)) {
        return runFormulaScoreSync(jobKey as FormulaScoreSyncJobKey);
      }
      throw new Error(`Unknown job key: ${jobKey}`);
  }
}

export async function evaluateAndDispatchDueJobs(): Promise<DispatchDueJobsResult> {
  loadSyncEnv();
  const useDb = useDbSyncSchedules();
  const dispatched: DataSyncJobKey[] = [];
  const skipped: DataSyncJobKey[] = [];

  if (!useDb) {
    return { dispatched, skipped: [...DATA_SYNC_JOB_KEYS], useDbSchedules: false };
  }

  const [schedules, lastRuns] = await Promise.all([
    loadDataSyncJobSchedules(),
    loadDataSyncJobLastRuns(),
  ]);
  const now = new Date();

  for (const jobKey of DATA_SYNC_JOB_KEYS) {
    const schedule = schedules[jobKey];
    if (!schedule) {
      skipped.push(jobKey);
      continue;
    }
    if (!shouldRunNow(schedule, now, lastRuns[jobKey])) {
      skipped.push(jobKey);
      continue;
    }
    await dispatchJob(jobKey);
    dispatched.push(jobKey);
  }

  return { dispatched, skipped, useDbSchedules: true };
}
