import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { DataSyncOrchestratorService } from '../trigger/data-sync-orchestrator.service';
import { CommitteeMembershipSyncService } from './committee-membership-sync.service';
import { CommitteeMembershipService } from './committee-membership.service';
import { CongressService } from './congress.service';
import { CommitteeSyncService } from './committee-sync.service';
import { CongressSyncService } from './congress-sync.service';

@Controller('congress')
@UseGuards(SupabaseAuthGuard)
export class CongressController {
  private readonly logger = new Logger(CongressController.name);

  constructor(
    private readonly congressService: CongressService,
    private readonly committeeMembershipService: CommitteeMembershipService,
    private readonly committeeMembershipSyncService: CommitteeMembershipSyncService,
    private readonly congressSyncService: CongressSyncService,
    private readonly committeeSyncService: CommitteeSyncService,
    private readonly syncOrchestrator: DataSyncOrchestratorService,
  ) {}

  @Get('members')
  async getMembers(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('congress') congress?: string,
  ) {
    const params: { limit?: number; offset?: number; congress?: number } = {};
    if (limit != null) {
      const n = parseInt(limit, 10);
      if (Number.isNaN(n) || n < 1 || n > 250) throw new BadRequestException('limit must be 1–250');
      params.limit = n;
    }
    if (offset != null) {
      const n = parseInt(offset, 10);
      if (Number.isNaN(n) || n < 0) throw new BadRequestException('offset must be non-negative');
      params.offset = n;
    }
    if (congress != null) {
      const n = parseInt(congress, 10);
      if (Number.isNaN(n) || n < 1) throw new BadRequestException('congress must be a positive integer');
      params.congress = n;
    }
    return this.congressService.getMembers(params);
  }

  @Get('members/:bioguideId')
  async getMemberByBioguideId(@Param('bioguideId') bioguideId: string) {
    const id = bioguideId?.trim();
    if (!id) throw new BadRequestException('bioguideId is required');
    return this.congressService.getMemberByBioguideId(id);
  }

  @Get('committees')
  async getCommittees() {
    return this.congressService.getCommittees();
  }

  @Get('committees/:congress')
  async getCommitteesByCongress(@Param('congress') congress: string) {
    const n = parseInt(congress, 10);
    if (Number.isNaN(n) || n < 1 || n > 999) throw new BadRequestException('congress must be 1–999');
    return this.congressService.getCommitteesByCongress(n);
  }

  @Get('committee-memberships/current')
  async getCommitteeMembershipCurrent() {
    return this.committeeMembershipService.getCommitteeMembershipCurrentParsed();
  }

  @Post('sync-members')
  async syncMembers() {
    return this.syncOrchestrator.runCongressMembers();
  }

  @Post('sync-committees')
  async syncCommittees() {
    return this.committeeSyncService.syncCurrentCommittees();
  }

  /** unitedstates YAML → politician_committee_memberships (platform admin). */
  @Post('sync-committee-memberships')
  @UseGuards(PlatformAdminGuard)
  async syncCommitteeMemberships() {
    try {
      return await this.syncOrchestrator.runCommitteeMemberships();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `syncCommitteeMemberships failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException(msg || 'Committee membership sync failed');
    }
  }
}
