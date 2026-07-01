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
import { LynchScoreService } from './lynch-score.service';
import { CalculateLynchScoreDto } from './dto/calculate-lynch-score.dto';

@Controller('stocks/lynch-score')
@UseGuards(SupabaseAuthGuard)
export class LynchScoreController {
  private readonly logger = new Logger(LynchScoreController.name);

  constructor(private readonly svc: LynchScoreService) {}

  @Get('scores')
  async getScores(@Query() query: CalculateLynchScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load Lynch scores');
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateLynchScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Lynch score calculation failed');
    }
  }
}
