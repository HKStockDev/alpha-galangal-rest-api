import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CommitteeMembershipSyncService } from '../congress/committee-membership-sync.service';
import { CongressSyncService } from '../congress/congress-sync.service';
import {
  formatFormulaScoreSyncSummary,
  FormulaScoreSyncService,
} from '../formula-score-sync/formula-score-sync.service';
import {
  FORMULA_SCORE_SYNC_JOB_KEYS,
  formulaScoreSyncEnvHint,
  type FormulaScoreSyncJobKey,
} from '../formula-score-sync/formula-score-sync.registry';
import { FmpService } from '../fmp/fmp.service';
import { TaxonomyCycleScoreService } from '../formulas/taxonomy-cycle-score.service';
import { TaxonomyStructuralGrowthService } from '../formulas/taxonomy-structural-growth.service';
import { SecurityEnrichmentService } from '../massive/security-enrichment.service';
import { PoliticalScoreService } from '../political-score/political-score.service';
import { TriggerRunHistoryService } from '../trigger/trigger-run-history.service';
import { upsertDataSyncJobLastRun, loadDataSyncJobLastRuns } from '../sync/data-sync-run-store';
import {
  loadDataSyncJobSchedules,
  useDbSyncSchedules,
} from '../sync/data-sync-schedules.store';
import {
  DATA_SYNC_DISPATCHER_CRON_DEFAULT,
  TRIGGER_SYNC_CRON_DEFAULTS,
  TRIGGER_SYNC_TASK_IDS,
} from '../trigger/trigger-task-ids';
import {
  DATA_SYNC_JOB_KEYS,
  type DataSyncJobKey,
  type DataSyncLastRun,
} from './data-sync.types';
import { formatScheduleSummary } from './schedule-evaluator';
import { DataSyncDispatcherService } from './data-sync-dispatcher.service';

export type { DataSyncJobKey, DataSyncLastRun } from './data-sync.types';
export { DATA_SYNC_JOB_KEYS } from './data-sync.types';

@Injectable()
export class DataSyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(DataSyncSchedulerService.name);
  private readonly lastRuns: Partial<Record<DataSyncJobKey, DataSyncLastRun>> = {};

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly triggerRunHistory: TriggerRunHistoryService,
    private readonly politicalScore: PoliticalScoreService,
    private readonly fmpService: FmpService,
    private readonly congressSync: CongressSyncService,
    private readonly committeeMembershipSync: CommitteeMembershipSyncService,
    private readonly taxonomyStructuralGrowthService: TaxonomyStructuralGrowthService,
    private readonly taxonomyCycleScoreService: TaxonomyCycleScoreService,
    private readonly securityEnrichment: SecurityEnrichmentService,
    private readonly formulaScoreSync: FormulaScoreSyncService,
    private readonly dispatcher: DataSyncDispatcherService,
  ) {}

  /** Read crons from process.env so UI matches what the OS process actually uses. */
  private cronPolitical(): string {
    return (process.env.DATA_SYNC_CRON_FMP_POLITICAL_TRADES ?? '').trim();
  }

  private cronFmpPoliticalFeedMissingSecurities(): string {
    return (process.env.DATA_SYNC_CRON_FMP_POLITICAL_FEED_MISSING_SECURITIES ?? '').trim();
  }

  private cronCongress(): string {
    return (process.env.DATA_SYNC_CRON_CONGRESS_MEMBERS ?? '').trim();
  }

  private cronCommitteeMemberships(): string {
    return (process.env.DATA_SYNC_CRON_COMMITTEE_MEMBERSHIPS ?? '').trim();
  }

  private cronTaxonomyStructuralGrowthCagrScores(): string {
    return (process.env.DATA_SYNC_CRON_TAXONOMY_STRUCTURAL_GROWTH_CAGR_SCORES ?? '').trim();
  }

  private cronEquityExposures(): string {
    return (process.env.DATA_SYNC_CRON_EQUITY_EXPOSURES ?? '').trim();
  }

  private cronFormulaScore(jobKey: FormulaScoreSyncJobKey): string {
    return (process.env[formulaScoreSyncEnvHint(jobKey)] ?? '').trim();
  }

  private cronTaxonomyCycleScores(): string {
    return (process.env.DATA_SYNC_CRON_TAXONOMY_CYCLE_SCORES ?? '').trim();
  }

  private taxonomyCycleScoresDelayMs(): number {
    const raw = process.env.DATA_SYNC_TAXONOMY_CYCLE_SCORES_DELAY_MS;
    const n = raw != null && raw !== '' ? Number.parseInt(String(raw).trim(), 10) : 1500;
    return Number.isFinite(n) && n >= 0 ? n : 1500;
  }

  private equityExposuresDelayMs(): number {
    const raw = process.env.DATA_SYNC_EQUITY_EXPOSURES_DELAY_MS;
    const n = raw != null && raw !== '' ? Number.parseInt(String(raw).trim(), 10) : 400;
    return Number.isFinite(n) && n >= 0 ? n : 400;
  }

  async getStatus(): Promise<{
    mode: 'trigger.dev' | 'nest-scheduler';
    triggerConfigured: boolean;
    inlineSyncAvailable: boolean;
    triggerProjectId: string;
    runHistory?: {
      databaseRowCount: number;
      triggerApiRunCount: number;
      triggerApiConfigured: boolean;
      hint?: string;
    };
    jobs: Record<
      DataSyncJobKey,
      {
        cron: string | null;
        scheduleSummary?: string | null;
        enabled?: boolean;
        lastRun: DataSyncLastRun | null;
        triggerTaskId?: string;
      }
    >;
  }> {
    const triggerConfigured = Boolean((process.env.TRIGGER_SECRET_KEY ?? '').trim());
    const useNestCron = (process.env.USE_NEST_DATA_SYNC_CRON ?? '').trim().toLowerCase() === 'true';
    const mode: 'trigger.dev' | 'nest-scheduler' =
      triggerConfigured && !useNestCron ? 'trigger.dev' : 'nest-scheduler';
    const cronPolitical = this.cronPolitical() || null;
    const cronGapFill = this.cronFmpPoliticalFeedMissingSecurities() || null;
    const cronCongress = this.cronCongress() || null;
    const cronCommitteeMemberships = this.cronCommitteeMemberships() || null;
    const cronTaxonomyStructuralGrowthCagrScores =
      this.cronTaxonomyStructuralGrowthCagrScores() || null;
    const cronEquityExposures = this.cronEquityExposures() || null;
    const cronTaxonomyCycleScores = this.cronTaxonomyCycleScores() || null;
    const triggerCron = (key: keyof typeof TRIGGER_SYNC_CRON_DEFAULTS) =>
      mode === 'trigger.dev' ? TRIGGER_SYNC_CRON_DEFAULTS[key] : null;
    const nestCron = (value: string | null) =>
      mode === 'nest-scheduler' ? value : null;

    const dbSchedules = useDbSyncSchedules() ? await loadDataSyncJobSchedules() : {};

    const jobMeta = (key: DataSyncJobKey) => {
      const dbRow = dbSchedules[key];
      const legacyCron = (() => {
        switch (key) {
          case 'fmpPoliticalTrades':
            return nestCron(cronPolitical) ?? triggerCron('fmpPoliticalTrades');
          case 'fmpPoliticalFeedMissingSecurities':
            return nestCron(cronGapFill) ?? triggerCron('fmpPoliticalFeedMissingSecurities');
          case 'congressMembers':
            return nestCron(cronCongress) ?? triggerCron('congressMembers');
          case 'committeeMemberships':
            return nestCron(cronCommitteeMemberships) ?? triggerCron('committeeMemberships');
          case 'taxonomyStructuralGrowthCagrScores':
            return (
              nestCron(cronTaxonomyStructuralGrowthCagrScores) ??
              triggerCron('taxonomyStructuralGrowthCagrScores')
            );
          case 'taxonomyCycleScores':
            return nestCron(cronTaxonomyCycleScores) ?? triggerCron('taxonomyCycleScores');
          case 'equityExposures':
            return nestCron(cronEquityExposures) ?? triggerCron('equityExposures');
          case 'jobsFactorsSync':
            return null;
          default:
            if ((FORMULA_SCORE_SYNC_JOB_KEYS as readonly string[]).includes(key)) {
              return (
                nestCron(this.cronFormulaScore(key as FormulaScoreSyncJobKey)) ??
                triggerCron(key as keyof typeof TRIGGER_SYNC_CRON_DEFAULTS)
              );
            }
            return null;
        }
      })();

      return {
        cron: dbRow ? formatScheduleSummary(dbRow) : legacyCron,
        scheduleSummary: dbRow ? formatScheduleSummary(dbRow) : null,
        enabled: dbRow?.enabled,
        lastRun: this.lastRuns[key] ?? null,
        triggerTaskId: TRIGGER_SYNC_TASK_IDS[key as keyof typeof TRIGGER_SYNC_TASK_IDS],
      };
    };

    const jobs: Record<
      DataSyncJobKey,
      {
        cron: string | null;
        scheduleSummary?: string | null;
        enabled?: boolean;
        lastRun: DataSyncLastRun | null;
        triggerTaskId?: string;
      }
    > = Object.fromEntries(DATA_SYNC_JOB_KEYS.map((key) => [key, jobMeta(key)])) as Record<
      DataSyncJobKey,
      {
        cron: string | null;
        scheduleSummary?: string | null;
        enabled?: boolean;
        lastRun: DataSyncLastRun | null;
        triggerTaskId?: string;
      }
    >;

    let runHistory:
      | {
          databaseRowCount: number;
          triggerApiRunCount: number;
          triggerApiConfigured: boolean;
          hint?: string;
        }
      | undefined;

    if (mode === 'trigger.dev') {
      const { runs: storedRuns, meta } = await this.triggerRunHistory.getLastRunsByJob();
      runHistory = meta;
      for (const key of DATA_SYNC_JOB_KEYS) {
        const stored = storedRuns[key];
        if (stored) jobs[key].lastRun = stored;
      }
    } else {
      const fromDb = await loadDataSyncJobLastRuns();
      runHistory = {
        databaseRowCount: Object.keys(fromDb).length,
        triggerApiRunCount: 0,
        triggerApiConfigured: false,
      };
      for (const key of DATA_SYNC_JOB_KEYS) {
        const local = this.lastRuns[key];
        const db = fromDb[key];
        if (db && local) {
          jobs[key].lastRun =
            new Date(db.at).getTime() >= new Date(local.at).getTime()
              ? { ...db, source: 'nest-scheduler' }
              : { ...local, source: 'nest-scheduler' };
        } else if (db) {
          jobs[key].lastRun = { ...db, source: 'nest-scheduler' };
        } else if (local) {
          jobs[key].lastRun = { ...local, source: 'nest-scheduler' };
        }
      }
    }

    return {
      mode,
      triggerConfigured,
      inlineSyncAvailable: !triggerConfigured || (process.env.SYNC_RUN_INLINE ?? '').trim().toLowerCase() === 'true',
      triggerProjectId: 'proj_cvznhcslwvsomhwyqjjy',
      runHistory,
      jobs,
    };
  }

  private async persistLastRun(
    jobKey: DataSyncJobKey,
    lastRun: DataSyncLastRun,
  ): Promise<void> {
    this.lastRuns[jobKey] = lastRun;
    await upsertDataSyncJobLastRun({
      jobKey,
      ok: lastRun.ok,
      summary: lastRun.summary,
      runId: lastRun.runId,
      source: 'nest-scheduler',
      triggerStatus: lastRun.triggerStatus,
      running: lastRun.running,
      finishedAt: lastRun.at,
    });
  }

  private shouldRegisterNestCronJobs(): boolean {
    const useNest = (process.env.USE_NEST_DATA_SYNC_CRON ?? '').trim().toLowerCase() === 'true';
    if (useNest) return true;
    return !(process.env.TRIGGER_SECRET_KEY ?? '').trim();
  }

  onModuleInit(): void {
    if (!this.shouldRegisterNestCronJobs()) {
      this.logger.log(
        'Nest in-process data-sync cron disabled (TRIGGER_SECRET_KEY set). Schedules run on Trigger.dev.',
      );
      return;
    }

    if (useDbSyncSchedules()) {
      const cron =
        (process.env.DATA_SYNC_DISPATCHER_CRON ?? '').trim() ||
        DATA_SYNC_DISPATCHER_CRON_DEFAULT;
      this.registerJob('syncDispatcher', cron, () =>
        this.dispatcher.evaluateAndDispatchDueJobs().then(() => undefined),
      );
      this.logger.log('DB-backed sync schedules enabled; per-job Nest crons skipped.');
      return;
    }

    this.registerJob('fmpPoliticalTrades', this.cronPolitical(), () =>
      this.runFmpPoliticalTrades(),
    );
    this.registerJob(
      'fmpPoliticalFeedMissingSecurities',
      this.cronFmpPoliticalFeedMissingSecurities(),
      () => this.runFmpPoliticalFeedMissingSecurities(),
    );
    this.registerJob('congressMembers', this.cronCongress(), () =>
      this.runCongressMembers(),
    );
    this.registerJob('committeeMemberships', this.cronCommitteeMemberships(), () =>
      this.runCommitteeMemberships(),
    );
    this.registerJob(
      'taxonomyStructuralGrowthCagrScores',
      this.cronTaxonomyStructuralGrowthCagrScores(),
      () => this.runTaxonomyStructuralGrowthCagrScores(),
    );
    this.registerJob('taxonomyCycleScores', this.cronTaxonomyCycleScores(), () =>
      this.runTaxonomyCycleScores(),
    );
    this.registerJob('equityExposures', this.cronEquityExposures(), () =>
      this.runEquityExposures(),
    );
    for (const key of FORMULA_SCORE_SYNC_JOB_KEYS) {
      this.registerJob(key, this.cronFormulaScore(key), () => this.runFormulaScoreSync(key));
    }
  }

  private registerJob(
    key: string,
    expressionRaw: string,
    task: () => Promise<void>,
  ): void {
    const expression = expressionRaw.trim();
    if (!expression) {
      this.logger.log(`Data sync job "${key}" disabled (set cron expression in env)`);
      return;
    }
    try {
      const job = new CronJob(expression, () => {
        void task();
      });
      this.schedulerRegistry.addCronJob(`dataSync.${key}`, job);
      job.start();
      this.logger.log(`Data sync job "${key}" scheduled: ${expression}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Invalid cron for "${key}" (${expression}): ${msg}`);
    }
  }

  private envHint(key: DataSyncJobKey): string {
    switch (key) {
      case 'fmpPoliticalTrades':
        return 'DATA_SYNC_CRON_FMP_POLITICAL_TRADES';
      case 'fmpPoliticalFeedMissingSecurities':
        return 'DATA_SYNC_CRON_FMP_POLITICAL_FEED_MISSING_SECURITIES';
      case 'congressMembers':
        return 'DATA_SYNC_CRON_CONGRESS_MEMBERS';
      case 'committeeMemberships':
        return 'DATA_SYNC_CRON_COMMITTEE_MEMBERSHIPS';
      case 'taxonomyStructuralGrowthCagrScores':
        return 'DATA_SYNC_CRON_TAXONOMY_STRUCTURAL_GROWTH_CAGR_SCORES';
      case 'taxonomyCycleScores':
        return 'DATA_SYNC_CRON_TAXONOMY_CYCLE_SCORES';
      case 'equityExposures':
        return 'DATA_SYNC_CRON_EQUITY_EXPOSURES';
      case 'politicalScore':
      case 'insiderPrecisionScore':
      case 'netExposureScore':
      case 'hedgeFundQualityScore':
      case 'fundamentalConstrictionScore':
      case 'buffettCommitteeScore':
      case 'burryCommitteeScore':
      case 'americaFirstScore':
        return formulaScoreSyncEnvHint(key);
      case 'jobsFactorsSync':
        return 'N/A (DB schedule)';
      default:
        return 'DATA_SYNC_CRON_*';
    }
  }

  /** Same as POST /fmp/sync-political-feed-missing-securities without dryRun (250ms between profiles). */
  private async runFmpPoliticalFeedMissingSecurities(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const r = await this.fmpService.syncMissingPoliticalFeedSymbolsToSecurities({
        delayMs: 250,
      });
      const ok = r.failed === 0 && r.errors.length === 0;
      await this.persistLastRun('fmpPoliticalFeedMissingSecurities', {
        at,
        ok,
        summary: `missing=${r.missingInSecurities} synced=${r.synced} filtered=${r.filtered} notFound=${r.notFound} failed=${r.failed}`,
      });
      if (!ok) {
        this.logger.warn(
          `FMP political-feed gap fill completed with issues: ${r.errors.slice(0, 5).join('; ')}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.persistLastRun('fmpPoliticalFeedMissingSecurities', { at, ok: false, summary: msg });
      this.logger.error(
        `FMP political-feed gap fill failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private async runFmpPoliticalTrades(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const r = await this.politicalScore.syncPoliticalTradesFromFmp();
      const ok = r.errors.length === 0;
      await this.persistLastRun('fmpPoliticalTrades', {
        at,
        ok,
        summary: `inserted=${r.inserted}; errors=${r.errors.length}`,
      });
      if (!ok) {
        this.logger.warn(`FMP political trades sync completed with errors: ${r.errors.join('; ')}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.persistLastRun('fmpPoliticalTrades', { at, ok: false, summary: msg });
      this.logger.error(`FMP political trades sync failed: ${msg}`, err instanceof Error ? err.stack : undefined);
    }
  }

  private async runCongressMembers(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const r = await this.congressSync.syncCurrentMembers();
      const ok = r.errors === 0;
      await this.persistLastRun('congressMembers', {
        at,
        ok,
        summary: `congress=${r.congress} synced=${r.synced} errors=${r.errors}`,
      });
      if (!ok) {
        this.logger.warn(`Congress member sync finished with ${r.errors} error(s)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.persistLastRun('congressMembers', { at, ok: false, summary: msg });
      this.logger.error(`Congress member sync failed: ${msg}`, err instanceof Error ? err.stack : undefined);
    }
  }

  private async runCommitteeMemberships(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const r = await this.committeeMembershipSync.syncFromYaml();
      const ok = true;
      await this.persistLastRun('committeeMemberships', {
        at,
        ok,
        summary: `upserted=${r.upserted} removed=${r.removed}; warnings=${r.warnings.length}`,
      });
      if (r.warnings.length) {
        this.logger.warn(`Committee membership sync: ${r.warnings.join(' ')}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.persistLastRun('committeeMemberships', { at, ok: false, summary: msg });
      this.logger.error(
        `Committee membership sync failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private async runTaxonomyCycleScores(): Promise<void> {
    const at = new Date().toISOString();
    const delayMs = this.taxonomyCycleScoresDelayMs();
    try {
      const r = await this.taxonomyCycleScoreService.run({ delayMs });
      const ok = r.errors.length === 0;
      await this.persistLastRun('taxonomyCycleScores', {
        at,
        ok,
        summary: `total=${r.entitiesTotal} processed=${r.entitiesProcessed} skippedNoPrompt=${r.skippedNoPrompt} llmCalls=${r.llmCalls} horizonUpserts=${r.horizonUpserts} errors=${r.errors.length}`,
      });
      if (!ok) {
        this.logger.warn(
          `Taxonomy cycle score sync completed with errors: ${r.errors.slice(0, 5).join('; ')}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.persistLastRun('taxonomyCycleScores', { at, ok: false, summary: msg });
      this.logger.error(
        `Taxonomy cycle score sync failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private async runTaxonomyStructuralGrowthCagrScores(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const r = await this.taxonomyStructuralGrowthService.syncCagrScoresFromStoredPayloads();
      const ok = r.errors.length === 0;
      await this.persistLastRun('taxonomyStructuralGrowthCagrScores', {
        at,
        ok,
        summary: `scanned=${r.entitiesScanned} horizonUpserts=${r.horizonScoresUpserted} composites=${r.compositesUpserted} withAll=${r.entitiesWithAllHorizons} missingAny=${r.entitiesMissingAnyHorizon} errors=${r.errors.length}`,
      });
      if (!ok) {
        this.logger.warn(
          `Taxonomy CAGR score sync completed with errors: ${r.errors.slice(0, 5).join('; ')}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.persistLastRun('taxonomyStructuralGrowthCagrScores', { at, ok: false, summary: msg });
      this.logger.error(
        `Taxonomy CAGR score sync failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private async runEquityExposures(): Promise<void> {
    const at = new Date().toISOString();
    const delayMs = this.equityExposuresDelayMs();
    try {
      const r = await this.securityEnrichment.syncExposuresForAllEquitySecurities({
        delayMs,
      });
      const ok = r.errors.length === 0;
      await this.persistLastRun('equityExposures', {
        at,
        ok,
        summary: `total=${r.total} processed=${r.processed} skippedNoProfile=${r.skippedNoProfile} exposuresRows=${r.exposuresAssignedTotal} errors=${r.errors.length}`,
      });
      if (!ok) {
        this.logger.warn(
          `Equity exposures sync completed with issues: ${r.errors.slice(0, 5).join('; ')}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.persistLastRun('equityExposures', { at, ok: false, summary: msg });
      this.logger.error(
        `Equity exposures sync failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private async runFormulaScoreSync(jobKey: FormulaScoreSyncJobKey): Promise<void> {
    const at = new Date().toISOString();
    try {
      const r = await this.formulaScoreSync.run(jobKey);
      const ok = r.errors.length === 0;
      await this.persistLastRun(jobKey, {
        at,
        ok,
        summary: formatFormulaScoreSyncSummary(r),
      });
      if (!ok) {
        this.logger.warn(
          `Formula score sync ${jobKey} completed with errors: ${r.errors
            .slice(0, 3)
            .map((e) => e.message)
            .join('; ')}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.persistLastRun(jobKey, { at, ok: false, summary: msg });
      this.logger.error(
        `Formula score sync ${jobKey} failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
