import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CongressModule } from '../congress/congress.module';
import { FmpModule } from '../fmp/fmp.module';
import { SyncOrchestratorModule } from '../trigger/sync-orchestrator.module';
import { PoliticalScoreController } from './political-score.controller';
import { PoliticalScoreService } from './political-score.service';

@Module({
  imports: [AuthModule, SyncOrchestratorModule, FmpModule, CongressModule],
  controllers: [PoliticalScoreController],
  providers: [PoliticalScoreService],
  exports: [PoliticalScoreService],
})
export class PoliticalScoreModule {}
