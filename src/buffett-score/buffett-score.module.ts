import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuffettScoreController } from './buffett-score.controller';
import { BuffettScoreService } from './buffett-score.service';

@Module({
  imports: [AuthModule],
  controllers: [BuffettScoreController],
  providers: [BuffettScoreService],
  exports: [BuffettScoreService],
})
export class BuffettScoreModule {}

