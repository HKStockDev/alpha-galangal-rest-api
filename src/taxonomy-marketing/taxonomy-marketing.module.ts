import { Module } from '@nestjs/common';
import { PublicTaxonomyMarketingController } from './public-taxonomy-marketing.controller';
import { TaxonomyMarketingService } from './taxonomy-marketing.service';

@Module({
  controllers: [PublicTaxonomyMarketingController],
  providers: [TaxonomyMarketingService],
  exports: [TaxonomyMarketingService],
})
export class TaxonomyMarketingModule {}
