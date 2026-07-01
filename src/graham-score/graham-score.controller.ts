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
import { GrahamScoreService } from './graham-score.service';
import { CalculateGrahamScoreDto } from './dto/calculate-graham-score.dto';

@Controller('stocks/graham-score')
@UseGuards(SupabaseAuthGuard)
export class GrahamScoreController {
  private readonly logger = new Logger(GrahamScoreController.name);

  constructor(private readonly svc: GrahamScoreService) {}

  @Get('scores')
  async getScores(@Query() query: CalculateGrahamScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load Graham scores');
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateGrahamScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Graham score calculation failed');
    }
  }
}
