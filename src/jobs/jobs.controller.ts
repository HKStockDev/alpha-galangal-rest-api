import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { FetchCompanyJobPostsDto } from './dto/fetch-company-job-posts.dto';
import { BatchLinkedinHeadcountDto, BatchLinkedinSecuritiesDto } from './dto/batch-linkedin-securities.dto';
import { ListActiveEmployeeOverviewQueryDto } from './dto/list-active-employee-overview-query.dto';
import { ListActiveJobCountsQueryDto } from './dto/list-active-job-counts-query.dto';
import { ListJobPostsQueryDto } from './dto/list-job-posts-query.dto';
import { PatchSecurityLinkedinUrlDto } from './dto/patch-security-linkedin-url.dto';
import { RefreshLinkedinHeadcountDto } from './dto/refresh-linkedin-headcount.dto';
import {
  BatchLinkedinRowResult,
  FetchCompanyIndeedPostsResult,
  JobsService,
  ListActiveEntityJobCountsResult,
  ListActiveEntitySecuritiesEmployeeOverviewResult,
  ListJobPostsResult,
  PatchSecurityLinkedinUrlResult,
  RefreshLinkedinHeadcountResult,
  SyncJobsFactorsResult,
  SyncCompanyIndeedPostsResult,
} from './jobs.service';

@Controller('jobs')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * CON-45 (point 1): fetch current company job postings from Indeed via Apify actor.
   */
  @Post('indeed/company-posts')
  async fetchCompanyPosts(
    @Body() body: FetchCompanyJobPostsDto,
  ): Promise<FetchCompanyIndeedPostsResult> {
    return this.jobsService.fetchCompanyIndeedPosts(body);
  }

  @Post('indeed/company-posts/sync')
  async syncCompanyPosts(
    @Body() body: FetchCompanyJobPostsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SyncCompanyIndeedPostsResult> {
    return this.jobsService.syncCompanyIndeedPosts(body, user.id);
  }

  @Get('posts')
  async listJobPosts(@Query() query: ListJobPostsQueryDto): Promise<ListJobPostsResult> {
    return this.jobsService.listJobPosts(query);
  }

  /**
   * Active US equities (default) with entity_id: FMP headcount from securities.total_employees.
   */
  @Get('active-entity-securities/employee-overview')
  async listActiveEntitySecuritiesEmployeeOverview(
    @Query() query: ListActiveEmployeeOverviewQueryDto,
  ): Promise<ListActiveEntitySecuritiesEmployeeOverviewResult> {
    return this.jobsService.listActiveEntitySecuritiesEmployeeOverview({
      q: query.q,
      market: query.market,
      locale: query.locale,
      offset: query.offset,
      limit: query.limit,
      securityIds: query.ids,
    });
  }

  /**
   * Per-company stored job-post counts (Indeed via `job_posts`) plus Riceman cached
   * `total_job_openings` for each active security with non-null `entity_id`.
   */
  @Get('active-entity-securities/job-counts')
  async listActiveEntitySecuritiesJobCounts(
    @Query() query: ListActiveJobCountsQueryDto,
  ): Promise<ListActiveEntityJobCountsResult> {
    return this.jobsService.listActiveEntityJobCounts({
      q: query.q,
      market: query.market,
      locale: query.locale,
      offset: query.offset,
      limit: query.limit,
    });
  }

  @Patch('securities/:securityId/linkedin-company-url')
  async patchSecurityLinkedinCompanyUrl(
    @Param('securityId', ParseUUIDPipe) securityId: string,
    @Body() body: PatchSecurityLinkedinUrlDto,
  ): Promise<PatchSecurityLinkedinUrlResult> {
    return this.jobsService.patchSecurityLinkedinCompanyUrl(securityId, body.linkedinCompanyUrl);
  }

  /**
   * When no `linkedin_company_url`, runs s-r/free-linkedin-company-finder (domain from FMP `homepage_url` or `domainOverride`),
   * then logical_scrapers + riceman headcount actors. Persists `linkedin_company_url` and `linkedin_headcount_cache`.
   */
  @Post('securities/:securityId/linkedin-headcount/refresh')
  async refreshSecurityLinkedinHeadcount(
    @Param('securityId', ParseUUIDPipe) securityId: string,
    @Body() body: RefreshLinkedinHeadcountDto,
  ): Promise<RefreshLinkedinHeadcountResult> {
    return this.jobsService.refreshLinkedinHeadcountCache(securityId, {
      getCompanyInsights: body.getCompanyInsights !== false,
      getTotalJobOpenings: body.getTotalJobOpenings !== false,
      resolveLinkedInFromDomain: body.resolveLinkedInFromDomain !== false,
      domainOverride: body.domainOverride?.trim() || undefined,
    });
  }

  /**
   * Step 1: for each `securityId`, run s-r company-finder (when no stored LinkedIn URL) and save `linkedin_company_url`.
   */
  @Post('securities/batch/linkedin-company-url')
  async batchResolveLinkedinCompanyUrls(
    @Body() body: BatchLinkedinSecuritiesDto,
  ): Promise<{ results: BatchLinkedinRowResult[] }> {
    return this.jobsService.batchResolveLinkedinCompanyUrls({
      securityIds: body.securityIds,
      domainOverrideBySecurityId: body.domainOverrideBySecurityId,
      market: body.market,
      locale: body.locale,
    });
  }

  /**
   * Step 2: for each `securityId` with a stored LinkedIn company URL, run logical_scrapers + riceman headcount actors.
   */
  @Post('securities/batch/linkedin-headcount')
  async batchFetchHeadcountFromLinkedin(
    @Body() body: BatchLinkedinHeadcountDto,
  ): Promise<{ results: BatchLinkedinRowResult[] }> {
    return this.jobsService.batchFetchHeadcountFromLinkedin({
      securityIds: body.securityIds,
      getCompanyInsights: body.getCompanyInsights !== false,
      getTotalJobOpenings: body.getTotalJobOpenings !== false,
      market: body.market,
      locale: body.locale,
    });
  }

  /**
   * CON-89: source-of-truth sync for jobs factors into both
   * entity_factor_values and entity_factor_values_ts.
   */
  @Post('factors/sync')
  async syncJobsFactors(
    @Body()
    body?: {
      asOfDate?: string;
      limit?: number;
      offset?: number;
      dryRun?: boolean;
    },
  ): Promise<SyncJobsFactorsResult> {
    return this.jobsService.syncJobsFactors({
      asOfDate: body?.asOfDate,
      limit: body?.limit,
      offset: body?.offset,
      dryRun: body?.dryRun,
    });
  }
}
