import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { OrgAdminGuard } from '../organizations/guards/org-admin.guard';
import { OrgMemberGuard } from '../organizations/guards/org-member.guard';
import { BillingService } from './billing.service';
import {
  ChangeSubscriptionPlanDto,
  CreateBillingPortalSessionDto,
  CreateCheckoutSessionDto,
} from './dto';

@Controller('organizations/:organizationId/billing')
@UseGuards(SupabaseAuthGuard)
export class OrganizationBillingController {
  constructor(private readonly billingService: BillingService) {}

  /** Subscription state from webhook-synced DB (for success-page polling). */
  @Get('status')
  @UseGuards(OrgMemberGuard)
  getBillingStatus(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: RequestUser,
  ) {
    if (user.isPlatformAdmin) {
      return this.billingService.getPlatformAdminBillingStatus(organizationId);
    }
    return this.billingService.getOrganizationBillingStatus(organizationId);
  }

  /** Active plan catalog for in-app pricing (amounts from subscription_plans). */
  @Get('plans')
  @UseGuards(OrgMemberGuard)
  listBillingPlans() {
    return this.billingService.listBillingPlanCatalog();
  }

  @Post('checkout')
  @UseGuards(OrgAdminGuard)
  async createCheckoutSession(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.billingService.createCheckoutSession({
      organizationId,
      planKey: dto.plan_key,
      seatQuantity: dto.seat_quantity,
      billingEmail: user.email,
      startTrial: dto.start_trial,
    });
  }

  /** Change an existing subscription to another plan (replaces Stripe portal plan picker). */
  @Post('change-plan')
  @UseGuards(OrgAdminGuard)
  async changeSubscriptionPlan(
    @Param('organizationId') organizationId: string,
    @Body() dto: ChangeSubscriptionPlanDto,
  ) {
    return this.billingService.changeSubscriptionPlan({
      organizationId,
      planKey: dto.plan_key,
      seatQuantity: dto.seat_quantity,
    });
  }

  /** End trial now and start billing on the current plan (optional early conversion). */
  @Post('end-trial')
  @UseGuards(OrgAdminGuard)
  async endTrialEarly(@Param('organizationId') organizationId: string) {
    return this.billingService.endSubscriptionTrialEarly(organizationId);
  }

  @Post('portal')
  @UseGuards(OrgAdminGuard)
  async createBillingPortalSession(
    @Param('organizationId') organizationId: string,
    @Body() dto?: CreateBillingPortalSessionDto,
  ) {
    return this.billingService.createBillingPortalSession(organizationId, dto?.flow ?? 'home');
  }
}
