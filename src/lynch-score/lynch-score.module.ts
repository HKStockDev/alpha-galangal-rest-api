import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LynchScoreController } from './lynch-score.controller';
import { LynchScoreService } from './lynch-score.service';

@Module({
  imports: [AuthModule],
  controllers: [LynchScoreController],
  providers: [LynchScoreService],
  exports: [LynchScoreService],
})
export class LynchScoreModule {}
