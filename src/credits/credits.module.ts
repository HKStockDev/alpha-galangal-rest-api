import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AdminCreditsController } from './admin-credits.controller';
import { CreditsService } from './credits.service';
import { OrganizationCreditsController } from './organization-credits.controller';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => OrganizationsModule),
    forwardRef(() => BillingModule),
  ],
  controllers: [OrganizationCreditsController, AdminCreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
