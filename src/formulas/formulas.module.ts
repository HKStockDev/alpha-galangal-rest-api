import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FundamentalConstrictionModule } from '../fundamental-constriction/fundamental-constriction.module';
import { HedgeFundsModule } from '../hedge-funds/hedge-funds.module';
import { EventFormulaRollupService } from '../market-content/event-formula-rollup.service';
import { MarketContentClassifierPreviewService } from '../market-content/market-content-classifier-preview.service';
import { ContentCategoriesService } from '../market-content/content-categories.service';
import { MarketContentPersistenceService } from '../market-content/market-content-persistence.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SyncOrchestratorModule } from '../trigger/sync-orchestrator.module';
import { PoliticalScoreModule } from '../political-score/political-score.module';
import { FormulasController } from './formulas.controller';
import { FormulasService } from './formulas.service';
import { TaxonomyCycleScoreService } from './taxonomy-cycle-score.service';
import { TaxonomyStructuralGrowthService } from './taxonomy-structural-growth.service';

@Module({
  imports: [
    AuthModule,
    SyncOrchestratorModule,
    HedgeFundsModule,
    FundamentalConstrictionModule,
    PoliticalScoreModule,
    OrganizationsModule,
  ],
  controllers: [FormulasController],
  providers: [
    FormulasService,
    TaxonomyStructuralGrowthService,
    TaxonomyCycleScoreService,
    EventFormulaRollupService,
    MarketContentClassifierPreviewService,
    ContentCategoriesService,
    MarketContentPersistenceService,
  ],
  exports: [TaxonomyStructuralGrowthService, TaxonomyCycleScoreService],
})
export class FormulasModule {}
