import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SyncOrchestratorModule } from '../trigger/sync-orchestrator.module';
import { CommitteeMembershipSyncService } from './committee-membership-sync.service';
import { CommitteeMembershipService } from './committee-membership.service';
import { CommitteeSyncService } from './committee-sync.service';
import { CongressController } from './congress.controller';
import { CongressSyncService } from './congress-sync.service';
import { CongressService } from './congress.service';

@Module({
  imports: [AuthModule, SyncOrchestratorModule],
  controllers: [CongressController],
  providers: [
    CongressService,
    CommitteeMembershipService,
    CommitteeMembershipSyncService,
    CongressSyncService,
    CommitteeSyncService,
  ],
  exports: [
    CongressService,
    CommitteeMembershipService,
    CommitteeMembershipSyncService,
    CongressSyncService,
    CommitteeSyncService,
  ],
})
export class CongressModule {}
