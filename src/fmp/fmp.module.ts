import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MassiveModule } from '../massive/massive.module';
import { SyncOrchestratorModule } from '../trigger/sync-orchestrator.module';
import { StockIngestFiltersModule } from '../stock-ingest-filters/stock-ingest-filters.module';
import { FmpController } from './fmp.controller';
import { FmpService } from './fmp.service';

@Module({
  imports: [
    AuthModule,
    SyncOrchestratorModule,
    StockIngestFiltersModule,
    forwardRef(() => MassiveModule),
  ],
  controllers: [FmpController],
  providers: [FmpService],
  exports: [FmpService],
})
export class FmpModule {}
