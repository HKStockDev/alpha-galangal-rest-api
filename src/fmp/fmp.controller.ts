import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { DataSyncOrchestratorService } from '../trigger/data-sync-orchestrator.service';
import { SecurityEnrichmentService } from '../massive/security-enrichment.service';
import { FmpService } from './fmp.service';
import type { FmpStockChartRange, IngestSecurityFmpNewsResult } from './fmp.service';

@Controller('fmp')
@UseGuards(SupabaseAuthGuard)
export class FmpController {
  constructor(
    private readonly fmpService: FmpService,
    private readonly securityEnrichmentService: SecurityEnrichmentService,
    private readonly syncOrchestrator: DataSyncOrchestratorService,
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

  @Get('stocks/:ticker/chart')
  async getStockChart(
    @Param('ticker') ticker: string,
    @Query('range') rangeRaw?: string,
  ) {
    const t = ticker?.trim();
    if (!t) throw new BadRequestException('ticker is required');
    const norm = (rangeRaw ?? '1Y').trim().toUpperCase();
    const allowed = new Set(['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX']);
    if (!allowed.has(norm)) {
      throw new BadRequestException('range must be one of 1D,5D,1M,3M,6M,YTD,1Y,5Y,MAX');
    }
    return this.fmpService.fetchStockChart(t, norm as FmpStockChartRange);
  }

  /** FMP v3 `stock_news` + `press-releases/{symbol}` (live; not stored in DB). */
  @Get('stocks/:ticker/news')
  async getStockNews(
    @Param('ticker') ticker: string,
    @Query('stock_limit') stockLimitRaw?: string,
    @Query('press_limit') pressLimitRaw?: string,
  ) {
    const t = ticker?.trim();
    if (!t) throw new BadRequestException('ticker is required');
    const stockNewsLimit =
      stockLimitRaw != null && stockLimitRaw !== ''
        ? Number.parseInt(stockLimitRaw, 10)
        : undefined;
    const pressReleasesLimit =
      pressLimitRaw != null && pressLimitRaw !== ''
        ? Number.parseInt(pressLimitRaw, 10)
        : undefined;
    if (
      stockNewsLimit !== undefined &&
      (Number.isNaN(stockNewsLimit) || stockNewsLimit < 1 || stockNewsLimit > 100)
    ) {
      throw new BadRequestException('stock_limit must be an integer from 1 to 100');
    }
    if (
      pressReleasesLimit !== undefined &&
      (Number.isNaN(pressReleasesLimit) || pressReleasesLimit < 1 || pressReleasesLimit > 100)
    ) {
      throw new BadRequestException('press_limit must be an integer from 1 to 100');
    }
    return this.fmpService.fetchStockNewsBundle(t, {
      stockNewsLimit,
      pressReleasesLimit,
    });
  }

  /** Latest FMP news / press rows stored in `security_fmp_news_items` for this security. */
  @Get('securities/:securityId/news')
  async getSecurityNewsCached(
    @Param('securityId') securityId: string,
    @Query('stock_limit') stockLimitRaw?: string,
    @Query('press_limit') pressLimitRaw?: string,
  ) {
    const id = securityId?.trim();
    if (!id) throw new BadRequestException('securityId is required');
    const stockNewsLimit =
      stockLimitRaw != null && stockLimitRaw !== ''
        ? Number.parseInt(stockLimitRaw, 10)
        : undefined;
    const pressReleasesLimit =
      pressLimitRaw != null && pressLimitRaw !== ''
        ? Number.parseInt(pressLimitRaw, 10)
        : undefined;
    if (
      stockNewsLimit !== undefined &&
      (Number.isNaN(stockNewsLimit) || stockNewsLimit < 1 || stockNewsLimit > 100)
    ) {
      throw new BadRequestException('stock_limit must be an integer from 1 to 100');
    }
    if (
      pressReleasesLimit !== undefined &&
      (Number.isNaN(pressReleasesLimit) || pressReleasesLimit < 1 || pressReleasesLimit > 100)
    ) {
      throw new BadRequestException('press_limit must be an integer from 1 to 100');
    }
    return this.fmpService.listSecurityFmpNewsFromDb(id, {
      stockNewsLimit,
      pressReleasesLimit,
    });
  }

  /** Fetch FMP v3 stock_news + press-releases for this security’s ticker and upsert into `security_fmp_news_items`. */
  @Post('securities/:securityId/news/ingest')
  @UseGuards(PlatformAdminGuard)
  async ingestSecurityNews(
    @Param('securityId') securityId: string,
    @Query('stock_limit') stockLimitRaw?: string,
    @Query('press_limit') pressLimitRaw?: string,
  ): Promise<IngestSecurityFmpNewsResult> {
    const id = securityId?.trim();
    if (!id) throw new BadRequestException('securityId is required');
    const stockNewsLimit =
      stockLimitRaw != null && stockLimitRaw !== ''
        ? Number.parseInt(stockLimitRaw, 10)
        : undefined;
    const pressReleasesLimit =
      pressLimitRaw != null && pressLimitRaw !== ''
        ? Number.parseInt(pressLimitRaw, 10)
        : undefined;
    if (
      stockNewsLimit !== undefined &&
      (Number.isNaN(stockNewsLimit) || stockNewsLimit < 1 || stockNewsLimit > 100)
    ) {
      throw new BadRequestException('stock_limit must be an integer from 1 to 100');
    }
    if (
      pressReleasesLimit !== undefined &&
      (Number.isNaN(pressReleasesLimit) || pressReleasesLimit < 1 || pressReleasesLimit > 100)
    ) {
      throw new BadRequestException('press_limit must be an integer from 1 to 100');
    }
    return this.fmpService.ingestSecurityFmpNewsFromFmp(id, {
      stockNewsLimit,
      pressReleasesLimit,
    });
  }

  /** FMP → `security_price_bars` upsert for one chart range (platform admin only). */
  @Post('securities/:securityId/chart-data/ingest')
  @UseGuards(PlatformAdminGuard)
  async ingestSecurityChartData(
    @Param('securityId') securityId: string,
    @Query('range') rangeRaw?: string,
  ) {
    const id = securityId?.trim();
    if (!id) throw new BadRequestException('securityId is required');
    const norm = (rangeRaw ?? '').trim().toUpperCase();
    const allowed = new Set(['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX']);
    if (!allowed.has(norm)) {
      throw new BadRequestException(
        'query param range is required and must be one of 1D,5D,1M,3M,6M,YTD,1Y,5Y,MAX',
      );
    }
    return this.fmpService.ingestStockChartBarsForSecurity(id, norm as FmpStockChartRange);
  }

  @Post('enrich')
  async enrichTickers(@Body() body: { tickers?: string[] }) {
    const tickers = body?.tickers;
    if (!Array.isArray(tickers) || tickers.length === 0) {
      throw new BadRequestException('tickers must be a non-empty array');
    }
    return this.securityEnrichmentService.enrichTickers(tickers);
  }

  /**
   * FMP senate/house latest → unique symbols not in `securities` → profile upsert per symbol.
   * Use `dryRun: true` to count only; `limit` to cap how many profiles to fetch (rate limits).
   */
  @Post('sync-political-feed-missing-securities')
  @UseGuards(PlatformAdminGuard)
  async syncPoliticalFeedMissingSecurities(
    @Body()
    body: {
      delayMs?: number;
      limit?: number | null;
      dryRun?: boolean;
    },
  ) {
    return this.syncOrchestrator.runFmpPoliticalFeedMissingSecurities(body ?? {});
  }
}
