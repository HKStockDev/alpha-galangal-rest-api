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
import { BuffettScoreService } from './buffett-score.service';
import { CalculateBuffettScoreDto } from './dto/calculate-buffett-score.dto';

@Controller('stocks/buffett-score')
@UseGuards(SupabaseAuthGuard)
export class BuffettScoreController {
  private readonly logger = new Logger(BuffettScoreController.name);

  constructor(private readonly svc: BuffettScoreService) {}

  @Get('scores')
  async getScores(@Query() query: CalculateBuffettScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load Buffett scores');
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateBuffettScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Buffett score calculation failed');
    }
  }
}

