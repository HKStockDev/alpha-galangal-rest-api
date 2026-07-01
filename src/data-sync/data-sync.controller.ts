import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { DataSyncOrchestratorService } from '../trigger/data-sync-orchestrator.service';
import type { DataSyncJobKey } from './data-sync.types';
import { DataSyncSchedulesService } from './data-sync-schedules.service';
import { DataSyncSchedulerService } from './data-sync-scheduler.service';
import { UpdateSyncScheduleDto } from './dto/update-sync-schedule.dto';

@Controller('admin/data-sync')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class DataSyncController {
  constructor(
    private readonly scheduler: DataSyncSchedulerService,
    private readonly syncOrchestrator: DataSyncOrchestratorService,
    private readonly schedules: DataSyncSchedulesService,
  ) {}

  @Get('status')
  getStatus() {
    return this.scheduler.getStatus();
  }

  @Get('schedules')
  listSchedules() {
    return this.schedules.listSchedules();
  }

  @Get('schedules/:jobKey')
  getSchedule(@Param('jobKey') jobKey: string) {
    return this.schedules.getSchedule(jobKey as DataSyncJobKey);
  }

  @Patch('schedules/:jobKey')
  patchSchedule(
    @Param('jobKey') jobKey: string,
    @Body() body: UpdateSyncScheduleDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.schedules.patchSchedule(
      jobKey as DataSyncJobKey,
      body,
      req.user?.id,
    );
  }

  @Post('run/taxonomy-cycle-scores')
  runTaxonomyCycleScores(
    @Body()
    body?: {
      delayMs?: number;
      limit?: number | null;
    },
  ) {
    return this.syncOrchestrator.runTaxonomyCycleScores({
      delayMs: body?.delayMs,
      limit: body?.limit,
    });
  }

  @Post('run/equity-exposures')
  runEquityExposures(
    @Body()
    body?: {
      delayMs?: number;
      limit?: number | null;
    },
  ) {
    return this.syncOrchestrator.runEquityExposures({
      delayMs: body?.delayMs,
      limit: body?.limit,
    });
  }

  @Post('run/jobs-factors-sync')
  runJobsFactorsSync(
    @Body()
    body?: {
      asOfDate?: string | null;
      limit?: number | null;
      offset?: number | null;
      dryRun?: boolean;
    },
  ) {
    return this.syncOrchestrator.runJobsFactorsSync(body);
  }

  @Post('run/political-score')
  runPoliticalScore(@Body() body?: { limit?: number | null }) {
    return this.syncOrchestrator.runPoliticalScore({ limit: body?.limit });
  }

  @Post('run/insider-precision-score')
  runInsiderPrecisionScore(@Body() body?: { limit?: number | null }) {
    return this.syncOrchestrator.runInsiderPrecisionScore({ limit: body?.limit });
  }

  @Post('run/net-exposure-score')
  runNetExposureScore(@Body() body?: { limit?: number | null }) {
    return this.syncOrchestrator.runNetExposureScore({ limit: body?.limit });
  }

  @Post('run/hedge-fund-quality-score')
  runHedgeFundQualityScore(@Body() body?: { limit?: number | null }) {
    return this.syncOrchestrator.runHedgeFundQualityScore({ limit: body?.limit });
  }

  @Post('run/fundamental-constriction-score')
  runFundamentalConstrictionScore(@Body() body?: { limit?: number | null }) {
    return this.syncOrchestrator.runFundamentalConstrictionScore({ limit: body?.limit });
  }

  @Post('run/buffett-committee-score')
  runBuffettCommitteeScore(@Body() body?: { limit?: number | null }) {
    return this.syncOrchestrator.runBuffettCommitteeScore({ limit: body?.limit });
  }

  @Post('run/burry-committee-score')
  runBurryCommitteeScore(@Body() body?: { limit?: number | null }) {
    return this.syncOrchestrator.runBurryCommitteeScore({ limit: body?.limit });
  }

  @Post('run/america-first-score')
  runAmericaFirstScore(@Body() body?: { limit?: number | null }) {
    return this.syncOrchestrator.runAmericaFirstScore({ limit: body?.limit });
  }
}
