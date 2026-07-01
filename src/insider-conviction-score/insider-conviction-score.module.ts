import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InsiderConvictionScoreController } from './insider-conviction-score.controller';
import { InsiderConvictionScoreService } from './insider-conviction-score.service';

@Module({
  imports: [AuthModule],
  controllers: [InsiderConvictionScoreController],
  providers: [InsiderConvictionScoreService],
  exports: [InsiderConvictionScoreService],
})
export class InsiderConvictionScoreModule {}
