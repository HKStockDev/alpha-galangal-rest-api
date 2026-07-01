import { Controller, Get, Query } from '@nestjs/common';
import { MarketingSearchService } from './marketing-search.service';

@Controller('public/marketing')
export class PublicMarketingSearchController {
  constructor(private readonly svc: MarketingSearchService) {}

  @Get('search')
  search(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.svc.search(q ?? '', limit);
  }
}
