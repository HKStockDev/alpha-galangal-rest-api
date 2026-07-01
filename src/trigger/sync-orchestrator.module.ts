import { Module } from '@nestjs/common';
import { DataSyncOrchestratorService } from './data-sync-orchestrator.service';
import { TriggerRunHistoryService } from './trigger-run-history.service';
import { TriggerSyncService } from './trigger-sync.service';

@Module({
  providers: [TriggerSyncService, TriggerRunHistoryService, DataSyncOrchestratorService],
  exports: [TriggerSyncService, TriggerRunHistoryService, DataSyncOrchestratorService],
})
export class SyncOrchestratorModule {}
