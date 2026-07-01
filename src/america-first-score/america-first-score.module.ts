import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AmericaFirstScoreController } from './america-first-score.controller';
import { AmericaFirstScoreService } from './america-first-score.service';

@Module({
  imports: [AuthModule],
  controllers: [AmericaFirstScoreController],
  providers: [AmericaFirstScoreService],
  exports: [AmericaFirstScoreService],
})
export class AmericaFirstScoreModule {}
