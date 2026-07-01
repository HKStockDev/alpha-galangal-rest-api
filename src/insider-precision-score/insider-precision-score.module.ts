import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InsiderPrecisionScoreController } from './insider-precision-score.controller';
import { InsiderPrecisionScoreService } from './insider-precision-score.service';

@Module({
  imports: [AuthModule],
  controllers: [InsiderPrecisionScoreController],
  providers: [InsiderPrecisionScoreService],
  exports: [InsiderPrecisionScoreService],
})
export class InsiderPrecisionScoreModule {}
