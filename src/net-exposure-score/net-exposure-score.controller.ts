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
import { CalculateNetExposureScoreDto } from './dto/calculate-net-exposure-score.dto';
import { NetExposureScoreService } from './net-exposure-score.service';

@Controller('stocks/net-exposure')
@UseGuards(SupabaseAuthGuard)
export class NetExposureScoreController {
  private readonly logger = new Logger(NetExposureScoreController.name);

  constructor(private readonly svc: NetExposureScoreService) {}

  @Get('scores')
  async getScores(@Query() query: CalculateNetExposureScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load net exposure scores');
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateNetExposureScoreDto) {
    try {
      return await this.svc.calculateScores({
        tickers: body?.tickers,
        limit: body?.limit,
        minScore: body?.minScore,
        maxScore: body?.maxScore,
        directionWeights: body?.directionWeights,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `calculateScores failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException(msg || 'Net exposure score calculation failed');
    }
  }
}
