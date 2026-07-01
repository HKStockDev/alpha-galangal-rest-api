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
import { BurryScoreService } from './burry-score.service';
import { CalculateBurryScoreDto } from './dto/calculate-burry-score.dto';

@Controller('stocks/burry-score')
@UseGuards(SupabaseAuthGuard)
export class BurryScoreController {
  private readonly logger = new Logger(BurryScoreController.name);

  constructor(private readonly svc: BurryScoreService) {}

  @Get('scores')
  async getScores(@Query() query: CalculateBurryScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load Burry scores');
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateBurryScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Burry score calculation failed');
    }
  }
}
