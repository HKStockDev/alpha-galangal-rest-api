import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FormulaMarketingController } from './formula-marketing.controller';
import { FormulaMarketingSnapshotService } from './formula-marketing-snapshot.service';
import { FormulaMarketingService } from './formula-marketing.service';
import { PublicFormulaMarketingController } from './public-formula-marketing.controller';

@Module({
  imports: [AuthModule],
  controllers: [FormulaMarketingController, PublicFormulaMarketingController],
  providers: [FormulaMarketingService, FormulaMarketingSnapshotService],
  exports: [FormulaMarketingService, FormulaMarketingSnapshotService],
})
export class FormulaMarketingModule {}
