import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { TaxonomyMarketingService } from './taxonomy-marketing.service';

/**
 * Unauthenticated read for marketing site: public exposure and tag library + hub pages.
 */
@Controller('public/marketing')
export class PublicTaxonomyMarketingController {
  constructor(private readonly svc: TaxonomyMarketingService) {}

  @Get('exposures')
  listExposures() {
    return this.svc.listPublicExposures();
  }

  @Get('exposures/:marketingSlug')
  async getExposureHub(@Param('marketingSlug') marketingSlug: string) {
    if (!marketingSlug?.trim()) {
      throw new NotFoundException('Exposure hub not found');
    }
    return this.svc.getExposureHubBySlug(marketingSlug);
  }

  @Get('tags')
  listTags() {
    return this.svc.listPublicTags();
  }

  @Get('tags/:marketingSlug')
  async getTagHub(@Param('marketingSlug') marketingSlug: string) {
    if (!marketingSlug?.trim()) {
      throw new NotFoundException('Tag hub not found');
    }
    return this.svc.getTagHubBySlug(marketingSlug);
  }
}
