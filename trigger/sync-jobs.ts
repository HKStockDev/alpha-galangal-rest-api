import { logger, schedules, task } from '@trigger.dev/sdk';
import type { FormulaScoreSyncJobKey } from '../src/formula-score-sync/formula-score-sync.registry';
import { evaluateAndDispatchDueJobs } from '../src/data-sync/data-sync-dispatcher';
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
} from '../src/sync/sync-runners';
import { useDbSyncSchedules } from '../src/sync/data-sync-schedules.store';
import { withRecordedDataSyncRun } from '../src/sync/with-recorded-data-sync-run';
import {
  DATA_SYNC_DISPATCHER_CRON_DEFAULT,
  TRIGGER_SYNC_CRON_DEFAULTS,
  TRIGGER_SYNC_DISPATCHER_TASK_ID,
  TRIGGER_SYNC_TASK_IDS,
} from '../src/trigger/trigger-task-ids';

const useDbSchedules = useDbSyncSchedules();

export const syncFmpPoliticalTradesTask = task({
  id: TRIGGER_SYNC_TASK_IDS.fmpPoliticalTrades,
  run: async (payload: { backfillMissingSecurities?: boolean }, { ctx }) => {
    logger.info('Starting FMP political trades sync');
    return withRecordedDataSyncRun(
      'fmpPoliticalTrades',
      TRIGGER_SYNC_TASK_IDS.fmpPoliticalTrades,
      () => runFmpPoliticalTrades(payload),
      { runId: ctx.run.id },
    );
  },
});

export const syncFmpPoliticalFeedMissingSecuritiesTask = task({
  id: TRIGGER_SYNC_TASK_IDS.fmpPoliticalFeedMissingSecurities,
  run: async (
    payload: {
      delayMs?: number;
      limit?: number | null;
      dryRun?: boolean;
    },
    { ctx },
  ) => {
    logger.info('Starting FMP political feed gap-fill sync');
    return withRecordedDataSyncRun(
      'fmpPoliticalFeedMissingSecurities',
      TRIGGER_SYNC_TASK_IDS.fmpPoliticalFeedMissingSecurities,
      () => runFmpPoliticalFeedMissingSecurities({ ...payload, dryRun: payload.dryRun ?? false }),
      { runId: ctx.run.id },
    );
  },
});

export const syncCongressMembersTask = task({
  id: TRIGGER_SYNC_TASK_IDS.congressMembers,
  run: async (_payload, { ctx }) => {
    logger.info('Starting Congress members sync');
    return withRecordedDataSyncRun(
      'congressMembers',
      TRIGGER_SYNC_TASK_IDS.congressMembers,
      () => runCongressMembers(),
      { runId: ctx.run.id },
    );
  },
});

export const syncCommitteeMembershipsTask = task({
  id: TRIGGER_SYNC_TASK_IDS.committeeMemberships,
  run: async (_payload, { ctx }) => {
    logger.info('Starting committee memberships sync');
    return withRecordedDataSyncRun(
      'committeeMemberships',
      TRIGGER_SYNC_TASK_IDS.committeeMemberships,
      () => runCommitteeMemberships(),
      { runId: ctx.run.id },
    );
  },
});

export const syncTaxonomyStructuralGrowthCagrScoresTask = task({
  id: TRIGGER_SYNC_TASK_IDS.taxonomyStructuralGrowthCagrScores,
  run: async (payload: { limit?: number }, { ctx }) => {
    logger.info('Starting taxonomy structural growth CAGR sync');
    return withRecordedDataSyncRun(
      'taxonomyStructuralGrowthCagrScores',
      TRIGGER_SYNC_TASK_IDS.taxonomyStructuralGrowthCagrScores,
      () => runTaxonomyStructuralGrowthCagrScores(payload),
      { runId: ctx.run.id },
    );
  },
});

export const syncTaxonomyCycleScoresTask = task({
  id: TRIGGER_SYNC_TASK_IDS.taxonomyCycleScores,
  run: async (payload: { delayMs?: number | null; limit?: number | null }, { ctx }) => {
    logger.info('Starting taxonomy cycle scores sync');
    return withRecordedDataSyncRun(
      'taxonomyCycleScores',
      TRIGGER_SYNC_TASK_IDS.taxonomyCycleScores,
      () => runTaxonomyCycleScores(payload),
      { runId: ctx.run.id },
    );
  },
});

export const syncEquityExposuresTask = task({
  id: TRIGGER_SYNC_TASK_IDS.equityExposures,
  run: async (payload: { delayMs?: number | null; limit?: number | null }, { ctx }) => {
    logger.info('Starting equity exposures sync');
    return withRecordedDataSyncRun(
      'equityExposures',
      TRIGGER_SYNC_TASK_IDS.equityExposures,
      () => runEquityExposures(payload),
      { runId: ctx.run.id },
    );
  },
});

export const syncJobsFactorsTask = task({
  id: TRIGGER_SYNC_TASK_IDS.jobsFactorsSync,
  run: async (
    payload: {
      asOfDate?: string | null;
      limit?: number | null;
      offset?: number | null;
      dryRun?: boolean;
    },
    { ctx },
  ) => {
    logger.info('Starting jobs factors sync');
    return withRecordedDataSyncRun(
      'jobsFactorsSync',
      TRIGGER_SYNC_TASK_IDS.jobsFactorsSync,
      () => runJobsFactorsSync(payload),
      { runId: ctx.run.id },
    );
  },
});

function formulaScoreTask(jobKey: FormulaScoreSyncJobKey) {
  const taskId = TRIGGER_SYNC_TASK_IDS[jobKey];
  return task({
    id: taskId,
    run: async (payload: { limit?: number | null }, { ctx }) => {
      logger.info(`Starting formula score sync: ${jobKey}`);
      return withRecordedDataSyncRun(
        jobKey,
        taskId,
        () => runFormulaScoreSync(jobKey, payload),
        { runId: ctx.run.id },
      );
    },
  });
}

export const syncPoliticalScoreTask = formulaScoreTask('politicalScore');
export const syncInsiderPrecisionScoreTask = formulaScoreTask('insiderPrecisionScore');
export const syncNetExposureScoreTask = formulaScoreTask('netExposureScore');
export const syncHedgeFundQualityScoreTask = formulaScoreTask('hedgeFundQualityScore');
export const syncFundamentalConstrictionScoreTask = formulaScoreTask('fundamentalConstrictionScore');
export const syncBuffettCommitteeScoreTask = formulaScoreTask('buffettCommitteeScore');
export const syncBurryCommitteeScoreTask = formulaScoreTask('burryCommitteeScore');
export const syncAmericaFirstScoreTask = formulaScoreTask('americaFirstScore');

export const syncDispatcherScheduledTask = schedules.task({
  id: TRIGGER_SYNC_DISPATCHER_TASK_ID,
  cron:
    (process.env.DATA_SYNC_DISPATCHER_CRON ?? '').trim() || DATA_SYNC_DISPATCHER_CRON_DEFAULT,
  run: async () => {
    if (!useDbSchedules) {
      logger.info('USE_DB_SYNC_SCHEDULES=false; dispatcher skipped');
      return { skipped: true };
    }
    logger.info('Evaluating DB sync schedules');
    return evaluateAndDispatchDueJobs();
  },
});

if (!useDbSchedules) {
  schedules.task({
    id: 'scheduled-sync-fmp-political-trades',
    cron: TRIGGER_SYNC_CRON_DEFAULTS.fmpPoliticalTrades,
    run: async () => syncFmpPoliticalTradesTask.trigger({ backfillMissingSecurities: true }),
  });

  schedules.task({
    id: 'scheduled-sync-fmp-political-feed-missing-securities',
    cron: TRIGGER_SYNC_CRON_DEFAULTS.fmpPoliticalFeedMissingSecurities,
    run: async () =>
      syncFmpPoliticalFeedMissingSecuritiesTask.trigger({ delayMs: 250, dryRun: false }),
  });

  schedules.task({
    id: 'scheduled-sync-congress-members',
    cron: TRIGGER_SYNC_CRON_DEFAULTS.congressMembers,
    run: async () => syncCongressMembersTask.trigger(),
  });

  schedules.task({
    id: 'scheduled-sync-committee-memberships',
    cron: TRIGGER_SYNC_CRON_DEFAULTS.committeeMemberships,
    run: async () => syncCommitteeMembershipsTask.trigger(),
  });

  schedules.task({
    id: 'scheduled-sync-taxonomy-cagr-scores',
    cron: TRIGGER_SYNC_CRON_DEFAULTS.taxonomyStructuralGrowthCagrScores,
    run: async () => syncTaxonomyStructuralGrowthCagrScoresTask.trigger(),
  });

  schedules.task({
    id: 'scheduled-sync-taxonomy-cycle-scores',
    cron: TRIGGER_SYNC_CRON_DEFAULTS.taxonomyCycleScores,
    run: async () => {
      const delayMs = Number.parseInt(
        process.env.DATA_SYNC_TAXONOMY_CYCLE_SCORES_DELAY_MS ?? '1500',
        10,
      );
      return syncTaxonomyCycleScoresTask.trigger({
        delayMs: Number.isFinite(delayMs) ? delayMs : 1500,
      });
    },
  });

  schedules.task({
    id: 'scheduled-sync-equity-exposures',
    cron: TRIGGER_SYNC_CRON_DEFAULTS.equityExposures,
    run: async () => {
      const delayMs = Number.parseInt(process.env.DATA_SYNC_EQUITY_EXPOSURES_DELAY_MS ?? '400', 10);
      return syncEquityExposuresTask.trigger({
        delayMs: Number.isFinite(delayMs) ? delayMs : 400,
      });
    },
  });

  const formulaScoreTasks = {
    politicalScore: syncPoliticalScoreTask,
    insiderPrecisionScore: syncInsiderPrecisionScoreTask,
    netExposureScore: syncNetExposureScoreTask,
    hedgeFundQualityScore: syncHedgeFundQualityScoreTask,
    fundamentalConstrictionScore: syncFundamentalConstrictionScoreTask,
    buffettCommitteeScore: syncBuffettCommitteeScoreTask,
    burryCommitteeScore: syncBurryCommitteeScoreTask,
    americaFirstScore: syncAmericaFirstScoreTask,
  } as const;

  const formulaScheduleIds: Record<FormulaScoreSyncJobKey, string> = {
    politicalScore: 'scheduled-sync-formula-political-score',
    insiderPrecisionScore: 'scheduled-sync-formula-insider-precision-score',
    netExposureScore: 'scheduled-sync-formula-net-exposure-score',
    hedgeFundQualityScore: 'scheduled-sync-formula-hedge-fund-quality-score',
    fundamentalConstrictionScore: 'scheduled-sync-formula-fundamental-constriction-score',
    buffettCommitteeScore: 'scheduled-sync-formula-buffett-committee-score',
    burryCommitteeScore: 'scheduled-sync-formula-burry-committee-score',
    americaFirstScore: 'scheduled-sync-formula-america-first-score',
  };

  for (const jobKey of Object.keys(formulaScoreTasks) as FormulaScoreSyncJobKey[]) {
    schedules.task({
      id: formulaScheduleIds[jobKey],
      cron: TRIGGER_SYNC_CRON_DEFAULTS[jobKey],
      run: async () => formulaScoreTasks[jobKey].trigger({}),
    });
  }
}
