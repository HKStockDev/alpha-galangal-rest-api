import type { DataSyncJobKey } from './data-sync.types';
import { FORMULA_SCORE_SYNC_JOB_LABELS } from '../formula-score-sync/formula-score-sync.registry';
import { FORMULA_KEY_BY_SCORE_SYNC_JOB } from '../formula-score-sync/formula-score-sync.registry';
import type { FormulaScoreSyncJobKey } from '../formula-score-sync/formula-score-sync.registry';

export type SyncJobCategory = 'pipeline' | 'taxonomy' | 'exposures' | 'formula' | 'jobs';

export interface SyncJobCatalogEntry {
  jobKey: DataSyncJobKey;
  displayName: string;
  category: SyncJobCategory;
  description: string;
  formulaKey?: string;
  manualRunPath?: string;
}

const PIPELINE_JOBS: SyncJobCatalogEntry[] = [
  {
    jobKey: 'fmpPoliticalTrades',
    displayName: 'FMP political trades',
    category: 'pipeline',
    description: 'Senate/house disclosures into political_trades.',
  },
  {
    jobKey: 'fmpPoliticalFeedMissingSecurities',
    displayName: 'FMP political feed gap fill',
    category: 'pipeline',
    description: 'Symbols in political feeds missing from securities.',
  },
  {
    jobKey: 'congressMembers',
    displayName: 'Congress members',
    category: 'pipeline',
    description: 'Congress.gov current members into politicians.',
  },
  {
    jobKey: 'committeeMemberships',
    displayName: 'Committee memberships',
    category: 'pipeline',
    description: 'YAML committee assignments sync.',
  },
];

const TAXONOMY_JOBS: SyncJobCatalogEntry[] = [
  {
    jobKey: 'taxonomyStructuralGrowthCagrScores',
    displayName: 'CAGR composite scores',
    category: 'taxonomy',
    description: 'Structural growth CAGR composites from stored payloads.',
    manualRunPath: 'taxonomy-cagr',
  },
  {
    jobKey: 'taxonomyCycleScores',
    displayName: 'Taxonomy cycle scores',
    category: 'taxonomy',
    description: 'Sector/industry cycle scores via Gemini.',
    manualRunPath: 'taxonomy-cycle-scores',
  },
];

const EXPOSURE_JOBS: SyncJobCatalogEntry[] = [
  {
    jobKey: 'equityExposures',
    displayName: 'Equity exposures (LLM)',
    category: 'exposures',
    description: 'FMP profile + Gemini security_exposures for all stocks.',
    manualRunPath: 'equity-exposures',
  },
];

const FORMULA_JOBS: SyncJobCatalogEntry[] = (
  Object.entries(FORMULA_SCORE_SYNC_JOB_LABELS) as [FormulaScoreSyncJobKey, string][]
).map(([jobKey, displayName]) => ({
  jobKey,
  displayName,
  category: 'formula' as const,
  description: `Recalculate ${displayName.toLowerCase()} and publish marketing snapshot.`,
  formulaKey: FORMULA_KEY_BY_SCORE_SYNC_JOB[jobKey],
  manualRunPath: formulaManualRunPath(jobKey),
}));

function formulaManualRunPath(jobKey: FormulaScoreSyncJobKey): string {
  const map: Record<FormulaScoreSyncJobKey, string> = {
    politicalScore: 'political-score',
    insiderConvictionScore: 'insider-conviction-score',
    netExposureScore: 'net-exposure-score',
    hedgeFundQualityScore: 'hedge-fund-quality-score',
    fundamentalConstrictionScore: 'fundamental-constriction-score',
    buffettCommitteeScore: 'buffett-committee-score',
    burryCommitteeScore: 'burry-committee-score',
    americaFirstScore: 'america-first-score',
  };
  return map[jobKey];
}

const JOBS_JOBS: SyncJobCatalogEntry[] = [
  {
    jobKey: 'jobsFactorsSync',
    displayName: 'Job growth factors',
    category: 'jobs',
    description: 'Sync jobs_growth_rate and related derived factors for all securities.',
    manualRunPath: 'jobs-factors-sync',
  },
];

export const SYNC_JOB_CATALOG: SyncJobCatalogEntry[] = [
  ...PIPELINE_JOBS,
  ...TAXONOMY_JOBS,
  ...EXPOSURE_JOBS,
  ...FORMULA_JOBS,
  ...JOBS_JOBS,
];

export const SYNC_JOB_CATALOG_BY_KEY: Record<DataSyncJobKey, SyncJobCatalogEntry> =
  Object.fromEntries(SYNC_JOB_CATALOG.map((e) => [e.jobKey, e])) as Record<
    DataSyncJobKey,
    SyncJobCatalogEntry
  >;

export const SYNC_JOB_CATEGORY_ORDER: SyncJobCategory[] = [
  'pipeline',
  'taxonomy',
  'exposures',
  'formula',
  'jobs',
];

export const SYNC_JOB_CATEGORY_LABELS: Record<SyncJobCategory, string> = {
  pipeline: 'Data pipelines',
  taxonomy: 'Taxonomy',
  exposures: 'Exposures',
  formula: 'Formula scores',
  jobs: 'Jobs',
};
