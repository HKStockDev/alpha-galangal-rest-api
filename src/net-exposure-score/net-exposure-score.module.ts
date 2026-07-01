import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NetExposureScoreController } from './net-exposure-score.controller';
import { NetExposureScoreService } from './net-exposure-score.service';

@Module({
  imports: [AuthModule],
  controllers: [NetExposureScoreController],
  providers: [NetExposureScoreService],
  exports: [NetExposureScoreService],
})
export class NetExposureScoreModule {}
