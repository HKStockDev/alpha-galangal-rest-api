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
import { AmericaFirstScoreService } from './america-first-score.service';
import { CalculateAmericaFirstScoreDto } from './dto/calculate-america-first-score.dto';

@Controller('stocks/america-first')
@UseGuards(SupabaseAuthGuard)
export class AmericaFirstScoreController {
  private readonly logger = new Logger(AmericaFirstScoreController.name);

  constructor(private readonly svc: AmericaFirstScoreService) {}

  @Get('scores')
  async getScores(@Query() query: CalculateAmericaFirstScoreDto) {
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
      throw new InternalServerErrorException(msg || 'Failed to load America First scores');
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateAmericaFirstScoreDto) {
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
      throw new InternalServerErrorException(msg || 'America First score calculation failed');
    }
  }
}
