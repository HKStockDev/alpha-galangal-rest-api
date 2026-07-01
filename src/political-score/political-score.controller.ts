import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { DataSyncOrchestratorService } from '../trigger/data-sync-orchestrator.service';
import { CalculatePoliticalScoreDto } from './dto/calculate-political-score.dto';
import { PoliticalScoreService } from './political-score.service';

@Controller('stocks/political-score')
@UseGuards(SupabaseAuthGuard)
export class PoliticalScoreController {
  private readonly logger = new Logger(PoliticalScoreController.name);

  constructor(
    private readonly svc: PoliticalScoreService,
    private readonly syncOrchestrator: DataSyncOrchestratorService,
  ) {}

  @Get('scores')
  async getScores(@Query() query: CalculatePoliticalScoreDto) {
    try {
      return await this.svc.loadCurrentScores({
        tickers: query.tickers,
        limit: query.limit,
        minScore: query.minScore,
        maxScore: query.maxScore,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`getScores failed: ${msg}`);
      throw new InternalServerErrorException(msg || 'Failed to load political scores');
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculatePoliticalScoreDto) {
    try {
      return await this.svc.calculateScores({
        tickers: body?.tickers,
        limit: body?.limit,
        minScore: body?.minScore,
        maxScore: body?.maxScore,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `calculateScores failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException(msg || 'Political score calculation failed');
    }
  }

  /** FMP senate/house latest → `political_trades` (filer matched to `politicians`). */
  @Post('sync-fmp-political-trades')
  @UseGuards(PlatformAdminGuard)
  async syncFmpPoliticalTrades(
    @Body()
    body?: {
      /** Default true: upsert unknown tickers via FMP profile before matching. */
      backfillMissingSecurities?: boolean;
    },
  ) {
    try {
      return await this.syncOrchestrator.runFmpPoliticalTrades({
        backfillMissingSecurities: body?.backfillMissingSecurities !== false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `syncFmpPoliticalTrades failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException(msg || 'FMP political trades sync failed');
    }
  }
}
