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
import { CalculateInsiderPrecisionScoreDto } from './dto/calculate-insider-precision-score.dto';
import { InsiderPrecisionScoreService } from './insider-precision-score.service';

@Controller('stocks/insider-precision')
@UseGuards(SupabaseAuthGuard)
export class InsiderPrecisionScoreController {
  private readonly logger = new Logger(InsiderPrecisionScoreController.name);

  constructor(private readonly svc: InsiderPrecisionScoreService) {}

  /** Return persisted scores without triggering a recalculation. */
  @Get('scores')
  async getScores(@Query() query: CalculateInsiderPrecisionScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load insider precision scores');
    }
  }

  /** Recalculate scores from insider trades and persist results. */
  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateInsiderPrecisionScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Insider precision score calculation failed');
    }
  }
}
