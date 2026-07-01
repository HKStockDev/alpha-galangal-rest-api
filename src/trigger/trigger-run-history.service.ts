import { Injectable, Logger } from '@nestjs/common';
import { configure, runs } from '@trigger.dev/sdk';
import type { DataSyncJobKey, DataSyncLastRun } from '../data-sync/data-sync.types';
import { DATA_SYNC_JOB_KEYS } from '../data-sync/data-sync.types';
import { loadDataSyncJobLastRuns } from '../sync/data-sync-run-store';
import { formatSyncOutputSummary } from './sync-output-summary';
import { TRIGGER_SYNC_TASK_IDS, type TriggerSyncTaskId } from './trigger-task-ids';

const TRIGGER_PROJECT_ID = 'proj_cvznhcslwvsomhwyqjjy';

const TASK_ID_TO_JOB_KEY = Object.fromEntries(
  Object.entries(TRIGGER_SYNC_TASK_IDS).map(([key, taskId]) => [taskId, key]),
) as Record<TriggerSyncTaskId, DataSyncJobKey>;

const RUNNING_STATUSES = new Set([
  'PENDING_VERSION',
  'QUEUED',
  'DEQUEUED',
  'EXECUTING',
  'WAITING',
  'DELAYED',
]);

export interface DataSyncRunHistoryMeta {
  databaseRowCount: number;
  triggerApiRunCount: number;
  triggerApiConfigured: boolean;
  hint?: string;
}

@Injectable()
export class TriggerRunHistoryService {
  private readonly logger = new Logger(TriggerRunHistoryService.name);
  private cache: {
    at: number;
    data: Partial<Record<DataSyncJobKey, DataSyncLastRun>>;
    meta: DataSyncRunHistoryMeta;
  } | null = null;

  private readonly cacheMs = 15_000;

  isConfigured(): boolean {
    return Boolean((process.env.TRIGGER_SECRET_KEY ?? '').trim());
  }

  async getLastRunsByJob(): Promise<{
    runs: Partial<Record<DataSyncJobKey, DataSyncLastRun>>;
    meta: DataSyncRunHistoryMeta;
  }> {
    if (this.cache && Date.now() - this.cache.at < this.cacheMs) {
      return { runs: this.cache.data, meta: this.cache.meta };
    }

    const fromDb = await loadDataSyncJobLastRuns();
    const fromTrigger = await this.fetchFromTriggerApi();
    const merged = this.mergeRuns(fromDb, fromTrigger.runs);

    const meta: DataSyncRunHistoryMeta = {
      databaseRowCount: Object.keys(fromDb).length,
      triggerApiRunCount: fromTrigger.count,
      triggerApiConfigured: this.isConfigured() || Boolean(this.personalAccessToken()),
      hint: this.buildHint(fromDb, fromTrigger.count),
    };

    this.cache = { at: Date.now(), data: merged, meta };
    return { runs: merged, meta };
  }

  private buildHint(
    fromDb: Partial<Record<DataSyncJobKey, DataSyncLastRun>>,
    triggerCount: number,
  ): string | undefined {
    if (Object.keys(fromDb).length > 0) return undefined;
    if (!this.isConfigured() && !this.personalAccessToken()) {
      return 'Set TRIGGER_SECRET_KEY on the API to read Trigger.dev run history.';
    }
    if (triggerCount === 0) {
      return (
        'Trigger.dev API returned no runs for this secret key. Use the dev secret key if runs were triggered in Development, or the prod key for Production. ' +
        'After deploying the updated sync tasks, re-run each job once — results are now saved to the database automatically.'
      );
    }
    return undefined;
  }

  private mergeRuns(
    fromDb: Partial<Record<DataSyncJobKey, DataSyncLastRun>>,
    fromTrigger: Partial<Record<DataSyncJobKey, DataSyncLastRun>>,
  ): Partial<Record<DataSyncJobKey, DataSyncLastRun>> {
    const merged: Partial<Record<DataSyncJobKey, DataSyncLastRun>> = {};
    for (const key of DATA_SYNC_JOB_KEYS) {
      const db = fromDb[key];
      const trig = fromTrigger[key];
      if (db && trig) {
        merged[key] = new Date(db.at).getTime() >= new Date(trig.at).getTime() ? db : trig;
      } else {
        merged[key] = db ?? trig;
      }
    }
    return merged;
  }

  private personalAccessToken(): string {
    return (process.env.TRIGGER_ACCESS_TOKEN ?? '').trim();
  }

  private configureTriggerClient(): void {
    const pat = this.personalAccessToken();
    const secretKey = (process.env.TRIGGER_SECRET_KEY ?? '').trim();
    if (pat) {
      configure({ accessToken: pat });
      return;
    }
    if (secretKey) {
      configure({ secretKey });
    }
  }

  private async fetchFromTriggerApi(): Promise<{
    runs: Partial<Record<DataSyncJobKey, DataSyncLastRun>>;
    count: number;
  }> {
    if (!this.isConfigured() && !this.personalAccessToken()) {
      return { runs: {}, count: 0 };
    }

    this.configureTriggerClient();
    const taskIds = Object.values(TRIGGER_SYNC_TASK_IDS);
    const pat = this.personalAccessToken();
    let count = 0;

    const entries = await Promise.all(
      taskIds.map(async (taskId) => {
        const jobKey = TASK_ID_TO_JOB_KEY[taskId];
        const lastRun = await this.fetchLatestRunForTask(taskId, Boolean(pat));
        if (lastRun) count += 1;
        return [jobKey, lastRun] as const;
      }),
    );

    const runsMap: Partial<Record<DataSyncJobKey, DataSyncLastRun>> = {};
    for (const [jobKey, lastRun] of entries) {
      if (lastRun) runsMap[jobKey] = lastRun;
    }
    return { runs: runsMap, count };
  }

  private async fetchLatestRunForTask(
    taskId: TriggerSyncTaskId,
    useProjectRuns: boolean,
  ): Promise<DataSyncLastRun | null> {
    try {
      const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const listParams = { taskIdentifier: taskId, limit: 1, from };
      const page = useProjectRuns
        ? await runs.list(TRIGGER_PROJECT_ID, listParams)
        : await runs.list(listParams);
      const run = page.data?.[0];
      if (!run) return null;

      const running = RUNNING_STATUSES.has(run.status);
      const at = (run.finishedAt ?? run.startedAt ?? run.createdAt).toISOString();
      let summary: string | undefined;
      let ok = run.isSuccess;

      if (run.isCompleted && run.id) {
        try {
          const full = await runs.retrieve(run.id);
          if (full.output != null) {
            summary = formatSyncOutputSummary(taskId, full.output);
          }
          if (full.error?.message) {
            summary = summary
              ? `${summary}; error=${full.error.message}`
              : full.error.message;
            ok = false;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.debug(`Could not retrieve output for run ${run.id}: ${msg}`);
        }
      }

      if (!summary) {
        const seconds = Math.round(run.durationMs / 1000);
        summary = running
          ? `${run.status} (started ${at})`
          : `${run.status}${seconds > 0 ? ` · ${seconds}s` : ''}`;
      }

      return {
        at,
        ok: running ? false : ok,
        summary,
        runId: run.id,
        triggerStatus: run.status,
        source: 'trigger.dev',
        running,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to list Trigger runs for ${taskId}: ${msg}`);
      return null;
    }
  }
}
