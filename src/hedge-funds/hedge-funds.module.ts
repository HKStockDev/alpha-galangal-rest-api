import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HedgeFundsController } from './hedge-funds.controller';
import { HedgeFundsService } from './hedge-funds.service';
import { HedgeFundQualityScoreService } from './hedge-fund-quality-score.service';

@Module({
  imports: [AuthModule],
  controllers: [HedgeFundsController],
  providers: [HedgeFundsService, HedgeFundQualityScoreService],
  exports: [HedgeFundQualityScoreService],
})
export class HedgeFundsModule {}
