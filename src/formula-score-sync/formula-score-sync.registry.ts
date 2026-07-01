import type { DataSyncJobKey } from '../data-sync/data-sync.types';

/** Formula score sync jobs (one per public marketing formula). */
export const FORMULA_SCORE_SYNC_JOB_KEYS = [
  'politicalScore',
  'insiderPrecisionScore',
  'netExposureScore',
  'hedgeFundQualityScore',
  'fundamentalConstrictionScore',
  'buffettCommitteeScore',
  'burryCommitteeScore',
  'americaFirstScore',
] as const;

export type FormulaScoreSyncJobKey = (typeof FORMULA_SCORE_SYNC_JOB_KEYS)[number];

export function isFormulaScoreSyncJobKey(key: string): key is FormulaScoreSyncJobKey {
  return (FORMULA_SCORE_SYNC_JOB_KEYS as readonly string[]).includes(key);
}

export const FORMULA_KEY_BY_SCORE_SYNC_JOB: Record<FormulaScoreSyncJobKey, string> = {
  politicalScore: 'political_score',
  insiderPrecisionScore: 'insider_precision_score',
  netExposureScore: 'net_exposure_score',
  hedgeFundQualityScore: 'hedge_fund_quality_score',
  fundamentalConstrictionScore: 'fundamental_constriction_score',
  buffettCommitteeScore: 'alpha_galangal_committee_buffett_score',
  burryCommitteeScore: 'alpha_galangal_committee_burry_score',
  americaFirstScore: 'america_first_score',
};

export const SCORE_SYNC_JOB_BY_FORMULA_KEY: Record<string, FormulaScoreSyncJobKey> =
  Object.fromEntries(
    Object.entries(FORMULA_KEY_BY_SCORE_SYNC_JOB).map(([job, formulaKey]) => [formulaKey, job]),
  ) as Record<string, FormulaScoreSyncJobKey>;

export const FORMULA_SCORE_SYNC_JOB_LABELS: Record<FormulaScoreSyncJobKey, string> = {
  politicalScore: 'Political Score',
  insiderPrecisionScore: 'Insider Precision Score',
  netExposureScore: 'Net Exposure Score',
  hedgeFundQualityScore: 'Hedge Fund Quality Score',
  fundamentalConstrictionScore: 'Fundamental Constriction Score',
  buffettCommitteeScore: 'Buffett Committee Score',
  burryCommitteeScore: 'Burry Committee Score',
  americaFirstScore: 'America First Score',
};

export function formulaScoreSyncEnvHint(key: FormulaScoreSyncJobKey): string {
  const map: Record<FormulaScoreSyncJobKey, string> = {
    politicalScore: 'DATA_SYNC_CRON_FORMULA_POLITICAL_SCORE',
    insiderPrecisionScore: 'DATA_SYNC_CRON_FORMULA_INSIDER_PRECISION_SCORE',
    netExposureScore: 'DATA_SYNC_CRON_FORMULA_NET_EXPOSURE_SCORE',
    hedgeFundQualityScore: 'DATA_SYNC_CRON_FORMULA_HEDGE_FUND_QUALITY_SCORE',
    fundamentalConstrictionScore: 'DATA_SYNC_CRON_FORMULA_FUNDAMENTAL_CONSTRICTION_SCORE',
    buffettCommitteeScore: 'DATA_SYNC_CRON_FORMULA_BUFFETT_COMMITTEE_SCORE',
    burryCommitteeScore: 'DATA_SYNC_CRON_FORMULA_BURRY_COMMITTEE_SCORE',
    americaFirstScore: 'DATA_SYNC_CRON_FORMULA_AMERICA_FIRST_SCORE',
  };
  return map[key];
}

export function isDataSyncJobKey(key: string): key is DataSyncJobKey {
  return [
    'fmpPoliticalTrades',
    'fmpPoliticalFeedMissingSecurities',
    'congressMembers',
    'committeeMemberships',
    'taxonomyStructuralGrowthCagrScores',
    'taxonomyCycleScores',
    'equityExposures',
    'jobsFactorsSync',
    ...FORMULA_SCORE_SYNC_JOB_KEYS,
  ].includes(key);
}
