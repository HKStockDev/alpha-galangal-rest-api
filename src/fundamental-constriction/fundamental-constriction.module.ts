import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FundamentalConstrictionController } from './fundamental-constriction.controller';
import { FundamentalConstrictionScoreService } from './fundamental-constriction-score.service';

@Module({
  imports: [AuthModule],
  controllers: [FundamentalConstrictionController],
  providers: [FundamentalConstrictionScoreService],
  exports: [FundamentalConstrictionScoreService],
})
export class FundamentalConstrictionModule {}
