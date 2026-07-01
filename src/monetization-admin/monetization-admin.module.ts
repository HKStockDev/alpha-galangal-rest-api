import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { MonetizationAdminController } from './monetization-admin.controller';
import { MonetizationAdminService } from './monetization-admin.service';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [MonetizationAdminController],
  providers: [MonetizationAdminService],
})
export class MonetizationAdminModule {}
