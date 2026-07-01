import { Module } from '@nestjs/common';
import { MarketingSearchService } from './marketing-search.service';
import { PublicMarketingSearchController } from './public-marketing-search.controller';

@Module({
  controllers: [PublicMarketingSearchController],
  providers: [MarketingSearchService],
  exports: [MarketingSearchService],
})
export class MarketingSearchModule {}
