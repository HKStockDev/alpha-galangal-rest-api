import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { CongressModule } from '../congress/congress.module';
import { FormulaScoreSyncModule } from '../formula-score-sync/formula-score-sync.module';
import { FmpModule } from '../fmp/fmp.module';
import { FormulasModule } from '../formulas/formulas.module';
import { JobsModule } from '../jobs/jobs.module';
import { MassiveModule } from '../massive/massive.module';
import { PoliticalScoreModule } from '../political-score/political-score.module';
import { SyncOrchestratorModule } from '../trigger/sync-orchestrator.module';
import { DataSyncController } from './data-sync.controller';
import { DataSyncDispatcherService } from './data-sync-dispatcher.service';
import { DataSyncSchedulesService } from './data-sync-schedules.service';
import { DataSyncSchedulerService } from './data-sync-scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    SyncOrchestratorModule,
    FormulaScoreSyncModule,
    FmpModule,
    PoliticalScoreModule,
    CongressModule,
    FormulasModule,
    MassiveModule,
    JobsModule,
  ],
  controllers: [DataSyncController],
  providers: [DataSyncSchedulerService, DataSyncSchedulesService, DataSyncDispatcherService],
  exports: [DataSyncSchedulerService, DataSyncSchedulesService, DataSyncDispatcherService],
})
export class DataSyncModule {}
