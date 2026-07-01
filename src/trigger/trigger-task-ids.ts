/** Task ids used by Trigger.dev and `tasks.trigger()` from the Nest API. */
export const TRIGGER_SYNC_TASK_IDS = {
  fmpPoliticalTrades: 'sync-fmp-political-trades',
  fmpPoliticalFeedMissingSecurities: 'sync-fmp-political-feed-missing-securities',
  congressMembers: 'sync-congress-members',
  committeeMemberships: 'sync-committee-memberships',
  taxonomyStructuralGrowthCagrScores: 'sync-taxonomy-structural-growth-cagr-scores',
  taxonomyCycleScores: 'sync-taxonomy-cycle-scores',
  equityExposures: 'sync-equity-exposures',
  politicalScore: 'sync-formula-political-score',
  insiderPrecisionScore: 'sync-formula-insider-precision-score',
  netExposureScore: 'sync-formula-net-exposure-score',
  hedgeFundQualityScore: 'sync-formula-hedge-fund-quality-score',
  fundamentalConstrictionScore: 'sync-formula-fundamental-constriction-score',
  buffettCommitteeScore: 'sync-formula-buffett-committee-score',
  burryCommitteeScore: 'sync-formula-burry-committee-score',
  americaFirstScore: 'sync-formula-america-first-score',
  jobsFactorsSync: 'sync-jobs-factors',
} as const;

export type TriggerSyncTaskId =
  (typeof TRIGGER_SYNC_TASK_IDS)[keyof typeof TRIGGER_SYNC_TASK_IDS];

/** Default cron schedules (UTC). Override via Trigger.dev dashboard if needed. */
export const TRIGGER_SYNC_CRON_DEFAULTS = {
  fmpPoliticalTrades: '0 */6 * * *',
  fmpPoliticalFeedMissingSecurities: '55 */6 * * *',
  congressMembers: '0 7 * * *',
  committeeMemberships: '30 8 * * *',
  taxonomyStructuralGrowthCagrScores: '0 9 * * *',
  equityExposures: '0 2 * * 0',
  taxonomyCycleScores: '15 3 * * 0',
  politicalScore: '0 10 * * 1',
  insiderPrecisionScore: '30 10 * * 1',
  netExposureScore: '0 11 * * 1',
  hedgeFundQualityScore: '30 11 * * 1',
  fundamentalConstrictionScore: '0 12 * * 1',
  buffettCommitteeScore: '0 4 * * 0',
  burryCommitteeScore: '30 4 * * 0',
  americaFirstScore: '30 12 * * 1',
} as const;

export const TRIGGER_SYNC_DISPATCHER_TASK_ID = 'sync-dispatcher';

export const DATA_SYNC_DISPATCHER_CRON_DEFAULT = '*/15 * * * *';
