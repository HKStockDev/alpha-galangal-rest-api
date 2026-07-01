import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreditsModule } from '../credits/credits.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { BillingEmailService } from './billing-email.service';
import { BillingPortalConfigService } from './billing-portal-config.service';
import { BillingService } from './billing.service';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingSetupController } from './billing-setup.controller';
import { BillingEntitlementGuard } from './guards/billing-entitlement.guard';
import { OrganizationBillingController } from './organization-billing.controller';

@Module({
  imports: [AuthModule, forwardRef(() => OrganizationsModule), forwardRef(() => CreditsModule)],
  controllers: [OrganizationBillingController, BillingWebhookController, BillingSetupController],
  providers: [
    BillingService,
    BillingWebhookService,
    BillingEmailService,
    BillingPortalConfigService,
    BillingEntitlementGuard,
  ],
  exports: [
    BillingService,
    BillingWebhookService,
    BillingEmailService,
    BillingPortalConfigService,
    BillingEntitlementGuard,
  ],
})
export class BillingModule {}
