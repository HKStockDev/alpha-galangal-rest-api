import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { BillingService } from './billing.service';

/** CON-98 S1: verify Stripe keys, webhook, and subscription_plans catalog before go-live. */
@Controller('billing')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class BillingSetupController {
  constructor(private readonly billingService: BillingService) {}

  @Get('setup')
  getSetupStatus() {
    return this.billingService.getBillingSetupStatus();
  }

  /** Push all active subscription_plans into Stripe Portal "Switch plan" catalog. */
  @Post('setup/sync-portal')
  syncPortalConfiguration() {
    return this.billingService.syncPortalConfigurationFromPlans();
  }
}
