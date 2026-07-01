import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GrahamScoreController } from './graham-score.controller';
import { GrahamScoreService } from './graham-score.service';

@Module({
  imports: [AuthModule],
  controllers: [GrahamScoreController],
  providers: [GrahamScoreService],
  exports: [GrahamScoreService],
})
export class GrahamScoreModule {}
