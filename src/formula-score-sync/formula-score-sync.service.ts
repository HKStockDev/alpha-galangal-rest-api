import { Injectable, Logger } from '@nestjs/common';
import { AmericaFirstScoreService } from '../america-first-score/america-first-score.service';
import { BuffettScoreService } from '../buffett-score/buffett-score.service';
import { BurryScoreService } from '../burry-score/burry-score.service';
import { FormulaMarketingSnapshotService } from '../formula-marketing/formula-marketing-snapshot.service';
import { FundamentalConstrictionScoreService } from '../fundamental-constriction/fundamental-constriction-score.service';
import { HedgeFundQualityScoreService } from '../hedge-funds/hedge-fund-quality-score.service';
import { InsiderConvictionScoreService } from '../insider-conviction-score/insider-conviction-score.service';
import { NetExposureScoreService } from '../net-exposure-score/net-exposure-score.service';
import { PoliticalScoreService } from '../political-score/political-score.service';
import {
  FORMULA_KEY_BY_SCORE_SYNC_JOB,
  type FormulaScoreSyncJobKey,
} from './formula-score-sync.registry';

export interface FormulaScoreSyncResult {
  jobKey: FormulaScoreSyncJobKey;
  formulaKey: string;
  asOf: string;
  entitiesProcessed: number;
  scoresWritten: number;
  errors: { ticker: string; message: string }[];
  snapshot: {
    skipped: boolean;
    reason?: string;
    releaseId?: string;
    slug?: string;
    rowCount?: number;
  };
}

function entitiesFromResult(result: {
  scoresWritten?: number;
  entitiesProcessed?: number;
  tickersWithData?: number;
}): number {
  if (typeof result.entitiesProcessed === 'number') return result.entitiesProcessed;
  if (typeof result.scoresWritten === 'number') return result.scoresWritten;
  if (typeof result.tickersWithData === 'number') return result.tickersWithData;
  return 0;
}

@Injectable()
export class FormulaScoreSyncService {
  private readonly logger = new Logger(FormulaScoreSyncService.name);

  constructor(
    private readonly politicalScore: PoliticalScoreService,
    private readonly insiderConvictionScore: InsiderConvictionScoreService,
    private readonly netExposureScore: NetExposureScoreService,
    private readonly hedgeFundQualityScore: HedgeFundQualityScoreService,
    private readonly fundamentalConstrictionScore: FundamentalConstrictionScoreService,
    private readonly buffettScore: BuffettScoreService,
    private readonly burryScore: BurryScoreService,
    private readonly americaFirstScore: AmericaFirstScoreService,
    private readonly marketingSnapshot: FormulaMarketingSnapshotService,
  ) {}

  async run(
    jobKey: FormulaScoreSyncJobKey,
    options?: { limit?: number | null },
  ): Promise<FormulaScoreSyncResult> {
    const formulaKey = FORMULA_KEY_BY_SCORE_SYNC_JOB[jobKey];
    const asOf = new Date().toISOString();
    const limit = options?.limit ?? undefined;

    let calcResult: {
      scoresWritten?: number;
      entitiesProcessed?: number;
      tickersWithData?: number;
      errors: { ticker: string; message: string }[];
    };

    switch (jobKey) {
      case 'politicalScore':
        calcResult = await this.politicalScore.calculateScores({ limit });
        break;
      case 'insiderConvictionScore':
        calcResult = await this.insiderConvictionScore.calculateScores({ limit });
        break;
      case 'netExposureScore':
        calcResult = await this.netExposureScore.calculateScores({ limit });
        break;
      case 'hedgeFundQualityScore': {
        const hf = await this.hedgeFundQualityScore.calculateQualityScores();
        calcResult = {
          entitiesProcessed: hf.entitiesProcessed,
          scoresWritten: hf.entitiesProcessed,
          errors: [],
        };
        break;
      }
      case 'fundamentalConstrictionScore':
        calcResult = await this.fundamentalConstrictionScore.calculateScores({ limit });
        break;
      case 'buffettCommitteeScore':
        calcResult = await this.buffettScore.calculateScores({ limit });
        break;
      case 'burryCommitteeScore':
        calcResult = await this.burryScore.calculateScores({ limit });
        break;
      case 'americaFirstScore':
        calcResult = await this.americaFirstScore.calculateScores({ limit });
        break;
      default: {
        const _exhaustive: never = jobKey;
        throw new Error(`Unknown formula score sync job: ${_exhaustive}`);
      }
    }

    const errors = calcResult.errors ?? [];
    const entitiesProcessed = entitiesFromResult(calcResult);
    const scoresWritten =
      typeof calcResult.scoresWritten === 'number'
        ? calcResult.scoresWritten
        : entitiesProcessed;

    let snapshot: FormulaScoreSyncResult['snapshot'] = {
      skipped: true,
      reason: 'Skipped due to calculation errors',
    };

    if (errors.length === 0 || scoresWritten > 0) {
      try {
        const snap = await this.marketingSnapshot.createReleaseFromCurrentScores(formulaKey, asOf);
        snapshot = snap;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Marketing snapshot failed for ${formulaKey}: ${msg}`);
        snapshot = { skipped: true, reason: msg };
      }
    }

    this.logger.log(
      `Formula sync ${jobKey}: scoresWritten=${scoresWritten} errors=${errors.length} snapshot=${snapshot.skipped ? 'skipped' : snapshot.slug}`,
    );

    return {
      jobKey,
      formulaKey,
      asOf,
      entitiesProcessed,
      scoresWritten,
      errors,
      snapshot,
    };
  }
}

export function formatFormulaScoreSyncSummary(result: FormulaScoreSyncResult): string {
  const snap = result.snapshot.skipped
    ? `snapshot=skipped(${result.snapshot.reason ?? 'unknown'})`
    : `snapshot=${result.snapshot.slug} rows=${result.snapshot.rowCount ?? 0}`;
  return `formula=${result.formulaKey} scores=${result.scoresWritten} errors=${result.errors.length}; ${snap}`;
}
