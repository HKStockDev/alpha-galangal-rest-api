import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { FormulaMarketingService } from './formula-marketing.service';

/**
 * Unauthenticated read for the marketing site: published release by slug, formula must be visibility=public.
 */
@Controller('public/marketing')
export class PublicFormulaMarketingController {
  constructor(private readonly svc: FormulaMarketingService) {}

  @Get('hubs/:marketingSlug')
  async getHubBySlug(@Param('marketingSlug') marketingSlug: string) {
    if (!marketingSlug?.trim()) {
      throw new NotFoundException('Hub not found');
    }
    return this.svc.getHubBySlugForPublic(marketingSlug);
  }

  @Get('releases/:slug')
  async getReleaseBySlug(@Param('slug') slug: string) {
    if (!slug?.trim()) {
      throw new NotFoundException('Release not found');
    }
    return this.svc.getReleaseBySlugForPublic(slug);
  }
}
