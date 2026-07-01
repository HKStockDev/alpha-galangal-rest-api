import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DruckenmillerScoreController } from './druckenmiller-score.controller';
import { DruckenmillerScoreService } from './druckenmiller-score.service';

@Module({
  imports: [AuthModule],
  controllers: [DruckenmillerScoreController],
  providers: [DruckenmillerScoreService],
  exports: [DruckenmillerScoreService],
})
export class DruckenmillerScoreModule {}
