import { Module } from '@nestjs/common';
import { AmericaFirstScoreModule } from '../america-first-score/america-first-score.module';
import { BuffettScoreModule } from '../buffett-score/buffett-score.module';
import { BurryScoreModule } from '../burry-score/burry-score.module';
import { FormulaMarketingSnapshotService } from '../formula-marketing/formula-marketing-snapshot.service';
import { FundamentalConstrictionModule } from '../fundamental-constriction/fundamental-constriction.module';
import { HedgeFundsModule } from '../hedge-funds/hedge-funds.module';
import { InsiderConvictionScoreModule } from '../insider-conviction-score/insider-conviction-score.module';
import { NetExposureScoreModule } from '../net-exposure-score/net-exposure-score.module';
import { PoliticalScoreModule } from '../political-score/political-score.module';
import { FormulaScoreSyncService } from './formula-score-sync.service';

@Module({
  imports: [
    PoliticalScoreModule,
    InsiderConvictionScoreModule,
    NetExposureScoreModule,
    HedgeFundsModule,
    FundamentalConstrictionModule,
    BuffettScoreModule,
    BurryScoreModule,
    AmericaFirstScoreModule,
  ],
  providers: [FormulaMarketingSnapshotService, FormulaScoreSyncService],
  exports: [FormulaScoreSyncService, FormulaMarketingSnapshotService],
})
export class FormulaScoreSyncModule {}
