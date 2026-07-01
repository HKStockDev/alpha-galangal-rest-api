import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { FmpService } from '../fmp/fmp.service';
import { SecurityEnrichmentService } from './security-enrichment.service';

@Controller('massive')
@UseGuards(SupabaseAuthGuard)
export class MassiveController {
  constructor(
    private readonly fmpService: FmpService,
    private readonly securityEnrichmentService: SecurityEnrichmentService,
  ) {}

  @Get('tickers/:ticker')
  async syncTicker(@Param('ticker') ticker: string) {
    const t = ticker?.trim();
    if (!t) throw new BadRequestException('ticker is required');
    const result = await this.fmpService.syncTickerToSecurities(t);
    if (result.ok) return result;
    if (result.code === 'filtered') {
      throw new BadRequestException(result.message);
    }
    throw new BadRequestException('Ticker not found or sync failed');
  }

  @Post('enrich')
  async enrichTickers(@Body() body: { tickers?: string[] }) {
    const tickers = body?.tickers;
    if (!Array.isArray(tickers) || tickers.length === 0) {
      throw new BadRequestException('tickers must be a non-empty array');
    }
    return this.securityEnrichmentService.enrichTickers(tickers);
  }
}
