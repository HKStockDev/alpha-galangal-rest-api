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
import { CalculateFundamentalConstrictionDto } from './dto/calculate-fundamental-constriction.dto';
import { FundamentalConstrictionScoreService } from './fundamental-constriction-score.service';

@Controller('stocks/fundamental-constriction')
@UseGuards(SupabaseAuthGuard)
export class FundamentalConstrictionController {
  private readonly logger = new Logger(FundamentalConstrictionController.name);

  constructor(private readonly svc: FundamentalConstrictionScoreService) {}

  @Get('scores')
  async getScores(@Query() query: CalculateFundamentalConstrictionDto) {
    try {
      return await this.svc.loadCurrentScores({
        tickers: query.tickers,
        limit: query.limit,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`getScores failed: ${msg}`);
      throw new InternalServerErrorException(
        msg || 'Failed to load fundamental constriction scores',
      );
    }
  }

  @Post('calculate-scores')
  async calculateScores(@Body() body: CalculateFundamentalConstrictionDto) {
    try {
      return await this.svc.calculateScores({
        tickers: body?.tickers,
        limit: body?.limit,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `calculateScores failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException(
        msg || 'Fundamental constriction score calculation failed',
      );
    }
  }
}
