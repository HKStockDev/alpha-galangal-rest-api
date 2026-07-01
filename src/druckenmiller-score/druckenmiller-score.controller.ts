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
import { DruckenmillerScoreService } from './druckenmiller-score.service';
import { CalculateDruckenmillerScoreDto } from './dto/calculate-druckenmiller-score.dto';

@Controller('stocks/druckenmiller-score')
@UseGuards(SupabaseAuthGuard)
export class DruckenmillerScoreController {
  private readonly logger = new Logger(DruckenmillerScoreController.name);

  constructor(private readonly svc: DruckenmillerScoreService) {}

  @Get('scores')
  async getScores(@Query() query: CalculateDruckenmillerScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load Druckenmiller scores');
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateDruckenmillerScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Druckenmiller score calculation failed');
    }
  }
}
