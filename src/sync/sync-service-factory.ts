import { ConfigService } from '@nestjs/config';
import configuration from '../config/configuration';
import { AmericaFirstScoreService } from '../america-first-score/america-first-score.service';
import { BuffettScoreService } from '../buffett-score/buffett-score.service';
import { BurryScoreService } from '../burry-score/burry-score.service';
import { CommitteeMembershipSyncService } from '../congress/committee-membership-sync.service';
import { CongressService } from '../congress/congress.service';
import { CongressSyncService } from '../congress/congress-sync.service';
import { FormulaMarketingSnapshotService } from '../formula-marketing/formula-marketing-snapshot.service';
import { FormulaScoreSyncService } from '../formula-score-sync/formula-score-sync.service';
import { TaxonomyCycleScoreService } from '../formulas/taxonomy-cycle-score.service';
import { TaxonomyStructuralGrowthService } from '../formulas/taxonomy-structural-growth.service';
import { FundamentalConstrictionScoreService } from '../fundamental-constriction/fundamental-constriction-score.service';
import { FmpService } from '../fmp/fmp.service';
import { HedgeFundQualityScoreService } from '../hedge-funds/hedge-fund-quality-score.service';
import { InsiderPrecisionScoreService } from '../insider-precision-score/insider-precision-score.service';
import { SecurityEnrichmentService } from '../massive/security-enrichment.service';
import { NetExposureScoreService } from '../net-exposure-score/net-exposure-score.service';
import { PoliticalScoreService } from '../political-score/political-score.service';
import { StockIngestFiltersService } from '../stock-ingest-filters/stock-ingest-filters.service';
import { JobsService } from '../jobs/jobs.service';
import { loadSyncEnv } from './load-env';

let configService: ConfigService | null = null;

function getConfig(): ConfigService {
  loadSyncEnv();
  if (!configService) {
    configService = new ConfigService(configuration());
  }
  return configService;
}

export function createStockIngestFiltersService(): StockIngestFiltersService {
  return new StockIngestFiltersService(getConfig());
}

export function createFmpService(): FmpService {
  const config = getConfig();
  return new FmpService(config, createStockIngestFiltersService());
}

export function createCongressService(): CongressService {
  return new CongressService(getConfig());
}

export function createCongressSyncService(): CongressSyncService {
  const config = getConfig();
  return new CongressSyncService(config, createCongressService());
}

export function createCommitteeMembershipSyncService(): CommitteeMembershipSyncService {
  return new CommitteeMembershipSyncService(getConfig());
}

export function createTaxonomyCycleScoreService(): TaxonomyCycleScoreService {
  return new TaxonomyCycleScoreService(getConfig());
}

export function createTaxonomyStructuralGrowthService(): TaxonomyStructuralGrowthService {
  return new TaxonomyStructuralGrowthService(getConfig());
}

export function createSecurityEnrichmentService(): SecurityEnrichmentService {
  return new SecurityEnrichmentService(getConfig(), createFmpService());
}

export function createPoliticalScoreService(): PoliticalScoreService {
  const config = getConfig();
  return new PoliticalScoreService(config, createFmpService(), createCongressService());
}

export function createInsiderPrecisionScoreService(): InsiderPrecisionScoreService {
  return new InsiderPrecisionScoreService(getConfig());
}

export function createNetExposureScoreService(): NetExposureScoreService {
  return new NetExposureScoreService(getConfig());
}

export function createHedgeFundQualityScoreService(): HedgeFundQualityScoreService {
  return new HedgeFundQualityScoreService(getConfig());
}

export function createFundamentalConstrictionScoreService(): FundamentalConstrictionScoreService {
  return new FundamentalConstrictionScoreService(getConfig());
}

export function createBuffettScoreService(): BuffettScoreService {
  return new BuffettScoreService(getConfig());
}

export function createBurryScoreService(): BurryScoreService {
  return new BurryScoreService(getConfig());
}

export function createAmericaFirstScoreService(): AmericaFirstScoreService {
  return new AmericaFirstScoreService(getConfig());
}

export function createFormulaMarketingSnapshotService(): FormulaMarketingSnapshotService {
  return new FormulaMarketingSnapshotService(getConfig());
}

export function createJobsService(): JobsService {
  return new JobsService(getConfig());
}

export function createFormulaScoreSyncService(): FormulaScoreSyncService {
  return new FormulaScoreSyncService(
    createPoliticalScoreService(),
    createInsiderPrecisionScoreService(),
    createNetExposureScoreService(),
    createHedgeFundQualityScoreService(),
    createFundamentalConstrictionScoreService(),
    createBuffettScoreService(),
    createBurryScoreService(),
    createAmericaFirstScoreService(),
    createFormulaMarketingSnapshotService(),
  );
}
