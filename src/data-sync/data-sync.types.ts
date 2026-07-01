export type DataSyncJobKey =
  | 'fmpPoliticalTrades'
  | 'fmpPoliticalFeedMissingSecurities'
  | 'congressMembers'
  | 'committeeMemberships'
  | 'taxonomyStructuralGrowthCagrScores'
  | 'taxonomyCycleScores'
  | 'equityExposures'
  | 'jobsFactorsSync'
  | 'politicalScore'
  | 'insiderPrecisionScore'
  | 'netExposureScore'
  | 'hedgeFundQualityScore'
  | 'fundamentalConstrictionScore'
  | 'buffettCommitteeScore'
  | 'burryCommitteeScore'
  | 'americaFirstScore';

export const DATA_SYNC_JOB_KEYS: readonly DataSyncJobKey[] = [
  'fmpPoliticalTrades',
  'fmpPoliticalFeedMissingSecurities',
  'congressMembers',
  'committeeMemberships',
  'taxonomyStructuralGrowthCagrScores',
  'taxonomyCycleScores',
  'equityExposures',
  'jobsFactorsSync',
  'politicalScore',
  'insiderPrecisionScore',
  'netExposureScore',
  'hedgeFundQualityScore',
  'fundamentalConstrictionScore',
  'buffettCommitteeScore',
  'burryCommitteeScore',
  'americaFirstScore',
];

export type SyncScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface DataSyncJobSchedule {
  job_key: DataSyncJobKey;
  enabled: boolean;
  frequency: SyncScheduleFrequency;
  timezone: string;
  hourly_interval_hours: number | null;
  hourly_start_time: string | null;
  market_days_only: boolean;
  daily_time: string | null;
  weekly_day_of_week: number | null;
  weekly_time: string | null;
  monthly_day_of_month: number | null;
  monthly_time: string | null;
  run_next_market_day_if_closed: boolean;
  updated_at: string;
  updated_by_user_id: string | null;
}

export interface DataSyncLastRun {
  at: string;
  ok: boolean;
  summary?: string;
  runId?: string;
  triggerStatus?: string;
  source?: 'trigger.dev' | 'nest-scheduler';
  running?: boolean;
}
