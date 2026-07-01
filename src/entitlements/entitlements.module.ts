import { Module } from '@nestjs/common';
import { EntitlementCheckService } from './entitlement-check.service';

@Module({
  providers: [EntitlementCheckService],
  exports: [EntitlementCheckService],
})
export class EntitlementsModule {}
