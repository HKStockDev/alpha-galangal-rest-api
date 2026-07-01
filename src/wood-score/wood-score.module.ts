import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WoodScoreController } from './wood-score.controller';
import { WoodScoreService } from './wood-score.service';

@Module({
  imports: [AuthModule],
  controllers: [WoodScoreController],
  providers: [WoodScoreService],
  exports: [WoodScoreService],
})
export class WoodScoreModule {}
