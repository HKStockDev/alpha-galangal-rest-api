import { IsEnum, IsOptional } from 'class-validator';
import { BILLING_PORTAL_FLOWS, BillingPortalFlow } from '../billing.constants';

export class CreateBillingPortalSessionDto {
  @IsOptional()
  @IsEnum(BILLING_PORTAL_FLOWS)
  flow?: BillingPortalFlow;
}
