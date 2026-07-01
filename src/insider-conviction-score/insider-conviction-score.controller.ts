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
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CalculateInsiderConvictionScoreDto } from './dto/calculate-insider-conviction-score.dto';
import { InsiderConvictionScoreService } from './insider-conviction-score.service';

@Controller('stocks/insider-conviction')
@UseGuards(SupabaseAuthGuard)
export class InsiderConvictionScoreController {
  private readonly logger = new Logger(InsiderConvictionScoreController.name);

  constructor(private readonly svc: InsiderConvictionScoreService) {}

  /** Return persisted scores without triggering a recalculation. */
  @Get('scores')
  async getScores(@Query() query: CalculateInsiderConvictionScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load insider conviction scores');
    }
  }

  /** Recalculate scores from insider trades and persist results. */
  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateInsiderConvictionScoreDto) {
    try {
      return await this.svc.calculateScores({
        tickers: body?.tickers,
        limit: body?.limit,
        minScore: body?.minScore,
        maxScore: body?.maxScore,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`calculateScores failed: ${msg}`, err instanceof Error ? err.stack : undefined);
      throw new InternalServerErrorException(msg || 'Insider conviction score calculation failed');
    }
  }
}
