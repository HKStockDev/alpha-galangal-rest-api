import { Injectable } from '@nestjs/common';
import type { FormulaScoreSyncJobKey } from '../formula-score-sync/formula-score-sync.registry';
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
import { TRIGGER_SYNC_TASK_IDS } from './trigger-task-ids';
import { TriggerSyncService } from './trigger-sync.service';
import type { TriggerDispatchResult } from './trigger-sync.types';

@Injectable()
export class DataSyncOrchestratorService {
  constructor(private readonly triggerSync: TriggerSyncService) {}

  runFmpPoliticalTrades(options?: { backfillMissingSecurities?: boolean }) {
    return this.runOrDispatch(
      TRIGGER_SYNC_TASK_IDS.fmpPoliticalTrades,
      {
        backfillMissingSecurities: options?.backfillMissingSecurities !== false,
      },
      () => runFmpPoliticalTrades(options),
    );
  }

  runFmpPoliticalFeedMissingSecurities(options?: {
    delayMs?: number;
    limit?: number | null;
    dryRun?: boolean;
  }) {
    return this.runOrDispatch(
      TRIGGER_SYNC_TASK_IDS.fmpPoliticalFeedMissingSecurities,
      options ?? {},
      () => runFmpPoliticalFeedMissingSecurities(options),
    );
  }

  runCongressMembers() {
    return this.runOrDispatch(
      TRIGGER_SYNC_TASK_IDS.congressMembers,
      {},
      () => runCongressMembers(),
    );
  }

  runCommitteeMemberships() {
    return this.runOrDispatch(
      TRIGGER_SYNC_TASK_IDS.committeeMemberships,
      {},
      () => runCommitteeMemberships(),
    );
  }

  runTaxonomyStructuralGrowthCagrScores(options?: { limit?: number }) {
    return this.runOrDispatch(
      TRIGGER_SYNC_TASK_IDS.taxonomyStructuralGrowthCagrScores,
      options ?? {},
      () => runTaxonomyStructuralGrowthCagrScores(options),
    );
  }

  runTaxonomyCycleScores(options?: { delayMs?: number | null; limit?: number | null }) {
    return this.runOrDispatch(
      TRIGGER_SYNC_TASK_IDS.taxonomyCycleScores,
      options ?? {},
      () => runTaxonomyCycleScores(options),
    );
  }

  runEquityExposures(options?: { delayMs?: number | null; limit?: number | null }) {
    return this.runOrDispatch(
      TRIGGER_SYNC_TASK_IDS.equityExposures,
      options ?? {},
      () => runEquityExposures(options),
    );
  }

  runPoliticalScore(options?: { limit?: number | null }) {
    return this.runFormulaScoreSync('politicalScore', options);
  }

  runInsiderConvictionScore(options?: { limit?: number | null }) {
    return this.runFormulaScoreSync('insiderConvictionScore', options);
  }

  runNetExposureScore(options?: { limit?: number | null }) {
    return this.runFormulaScoreSync('netExposureScore', options);
  }

  runHedgeFundQualityScore(options?: { limit?: number | null }) {
    return this.runFormulaScoreSync('hedgeFundQualityScore', options);
  }

  runFundamentalConstrictionScore(options?: { limit?: number | null }) {
    return this.runFormulaScoreSync('fundamentalConstrictionScore', options);
  }

  runBuffettCommitteeScore(options?: { limit?: number | null }) {
    return this.runFormulaScoreSync('buffettCommitteeScore', options);
  }

  runBurryCommitteeScore(options?: { limit?: number | null }) {
    return this.runFormulaScoreSync('burryCommitteeScore', options);
  }

  runAmericaFirstScore(options?: { limit?: number | null }) {
    return this.runFormulaScoreSync('americaFirstScore', options);
  }

  runJobsFactorsSync(options?: {
    asOfDate?: string | null;
    limit?: number | null;
    offset?: number | null;
    dryRun?: boolean;
  }) {
    return this.runOrDispatch(
      TRIGGER_SYNC_TASK_IDS.jobsFactorsSync,
      options ?? {},
      () => runJobsFactorsSync(options),
    );
  }

  private runFormulaScoreSync(jobKey: FormulaScoreSyncJobKey, options?: { limit?: number | null }) {
    return this.runOrDispatch(
      TRIGGER_SYNC_TASK_IDS[jobKey],
      { limit: options?.limit ?? null },
      () => runFormulaScoreSync(jobKey, options),
    );
  }

  private async runOrDispatch<TPayload extends Record<string, unknown>, TResult>(
    taskId: (typeof TRIGGER_SYNC_TASK_IDS)[keyof typeof TRIGGER_SYNC_TASK_IDS],
    payload: TPayload,
    inline: () => Promise<TResult>,
  ): Promise<TriggerDispatchResult | TResult> {
    if (this.triggerSync.useTriggerDispatch()) {
      return this.triggerSync.dispatch(taskId, payload);
    }
    return inline();
  }
}
