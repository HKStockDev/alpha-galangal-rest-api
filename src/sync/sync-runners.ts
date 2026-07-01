import { loadSyncEnv } from './load-env';
import {
  createCommitteeMembershipSyncService,
  createCongressSyncService,
  createFormulaScoreSyncService,
  createFmpService,
  createJobsService,
  createPoliticalScoreService,
  createSecurityEnrichmentService,
  createTaxonomyCycleScoreService,
  createTaxonomyStructuralGrowthService,
} from './sync-service-factory';
import type { FormulaScoreSyncJobKey } from '../formula-score-sync/formula-score-sync.registry';

export async function runFmpPoliticalTrades(options?: {
  backfillMissingSecurities?: boolean;
}) {
  loadSyncEnv();
  return createPoliticalScoreService().syncPoliticalTradesFromFmp({
    backfillMissingSecurities: options?.backfillMissingSecurities !== false,
  });
}

export async function runFmpPoliticalFeedMissingSecurities(options?: {
  delayMs?: number;
  limit?: number | null;
  dryRun?: boolean;
}) {
  loadSyncEnv();
  return createFmpService().syncMissingPoliticalFeedSymbolsToSecurities(options ?? {});
}

export async function runCongressMembers() {
  loadSyncEnv();
  return createCongressSyncService().syncCurrentMembers();
}

export async function runCommitteeMemberships() {
  loadSyncEnv();
  return createCommitteeMembershipSyncService().syncFromYaml();
}

export async function runTaxonomyStructuralGrowthCagrScores(options?: { limit?: number }) {
  loadSyncEnv();
  return createTaxonomyStructuralGrowthService().syncCagrScoresFromStoredPayloads({
    limit: options?.limit,
  });
}

export async function runTaxonomyCycleScores(options?: {
  delayMs?: number | null;
  limit?: number | null;
}) {
  loadSyncEnv();
  return createTaxonomyCycleScoreService().run({
    delayMs: options?.delayMs,
    limit: options?.limit,
  });
}

export async function runEquityExposures(options?: {
  delayMs?: number | null;
  limit?: number | null;
}) {
  loadSyncEnv();
  return createSecurityEnrichmentService().syncExposuresForAllEquitySecurities({
    delayMs: options?.delayMs ?? undefined,
    limit: options?.limit,
  });
}

export async function runFormulaScoreSync(
  jobKey: FormulaScoreSyncJobKey,
  options?: { limit?: number | null },
) {
  loadSyncEnv();
  return createFormulaScoreSyncService().run(jobKey, options);
}

export async function runJobsFactorsSync(options?: {
  asOfDate?: string | null;
  limit?: number | null;
  offset?: number | null;
  dryRun?: boolean;
}) {
  loadSyncEnv();
  return createJobsService().syncJobsFactors(options);
}
