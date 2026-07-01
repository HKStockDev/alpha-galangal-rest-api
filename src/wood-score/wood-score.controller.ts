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
import { WoodScoreService } from './wood-score.service';
import { CalculateWoodScoreDto } from './dto/calculate-wood-score.dto';

@Controller('stocks/wood-score')
@UseGuards(SupabaseAuthGuard)
export class WoodScoreController {
  private readonly logger = new Logger(WoodScoreController.name);

  constructor(private readonly svc: WoodScoreService) {}

  @Get('scores')
  async getScores(@Query() query: CalculateWoodScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load Wood scores');
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateWoodScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Wood score calculation failed');
    }
  }
}
