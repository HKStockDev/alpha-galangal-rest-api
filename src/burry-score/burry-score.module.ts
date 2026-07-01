import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BurryScoreController } from './burry-score.controller';
import { BurryScoreService } from './burry-score.service';

@Module({
  imports: [AuthModule],
  controllers: [BurryScoreController],
  providers: [BurryScoreService],
  exports: [BurryScoreService],
})
export class BurryScoreModule {}
