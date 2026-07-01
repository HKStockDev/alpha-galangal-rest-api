import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { BulkEnableReadonlyDto } from './dto/bulk-enable-readonly.dto';
import { CopyEntitlementsDto } from './dto/copy-entitlements.dto';
import { ListOrgSubscriptionsQueryDto } from './dto/list-org-subscriptions-query.dto';
import { ListPlansQueryDto } from './dto/list-plans-query.dto';
import { ListStripeEventsQueryDto } from './dto/list-stripe-events-query.dto';
import { PreviewEntitlementDto } from './dto/preview-entitlement.dto';
import { UpdateEntitlementDto } from './dto/update-entitlement.dto';
import { MonetizationAdminService } from './monetization-admin.service';
import type {
  BulkEnableReadonlyResult,
  CopyEntitlementsResult,
  EntitlementCell,
  EntitlementPreviewResult,
  EntitlementsMatrixResponse,
  OrgSubscriptionDetailResponse,
  OrgSubscriptionListItem,
  RetryStripeEventResult,
  StripeEventLogDetail,
  StripeEventLogListItem,
  SubscriptionPlanAdminRow,
  SyncPlansFromStripeResult,
} from './monetization-admin.types';

@Controller('admin/monetization')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class MonetizationAdminController {
  constructor(private readonly monetizationAdmin: MonetizationAdminService) {}

  @Get('plans')
  listPlans(@Query() query: ListPlansQueryDto): Promise<SubscriptionPlanAdminRow[]> {
    return this.monetizationAdmin.listPlans(query);
  }

  @Post('plans/sync-stripe')
  syncPlansFromStripe(): Promise<SyncPlansFromStripeResult> {
    return this.monetizationAdmin.syncPlansFromStripe();
  }

  @Get('organizations')
  searchOrganizationSubscriptions(
    @Query() query: ListOrgSubscriptionsQueryDto,
  ): Promise<OrgSubscriptionListItem[]> {
    return this.monetizationAdmin.searchOrganizationSubscriptions(query);
  }

  @Get('organizations/:orgId/subscription')
  getOrganizationSubscription(
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<OrgSubscriptionDetailResponse> {
    return this.monetizationAdmin.getOrganizationSubscriptionDetail(orgId);
  }

  @Get('stripe-events')
  listStripeEvents(
    @Query() query: ListStripeEventsQueryDto,
  ): Promise<StripeEventLogListItem[]> {
    return this.monetizationAdmin.listStripeEvents(query);
  }

  @Get('stripe-events/:id')
  getStripeEvent(@Param('id', ParseUUIDPipe) id: string): Promise<StripeEventLogDetail> {
    return this.monetizationAdmin.getStripeEventDetail(id);
  }

  @Post('stripe-events/:id/retry')
  retryStripeEvent(@Param('id', ParseUUIDPipe) id: string): Promise<RetryStripeEventResult> {
    return this.monetizationAdmin.retryStripeEvent(id);
  }

  @Get('entitlements/matrix')
  getEntitlementsMatrix(): Promise<EntitlementsMatrixResponse> {
    return this.monetizationAdmin.getEntitlementsMatrix();
  }

  @Post('entitlements/preview')
  previewEntitlement(@Body() dto: PreviewEntitlementDto): Promise<EntitlementPreviewResult> {
    return this.monetizationAdmin.previewEntitlement(dto);
  }

  @Post('entitlements/bulk/enable-readonly')
  bulkEnableReadonly(
    @Body() dto: BulkEnableReadonlyDto,
    @CurrentUser() user: RequestUser,
  ): Promise<BulkEnableReadonlyResult> {
    return this.monetizationAdmin.bulkEnableReadonly(dto, user.id);
  }

  @Post('entitlements/bulk/copy')
  copyEntitlements(
    @Body() dto: CopyEntitlementsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CopyEntitlementsResult> {
    return this.monetizationAdmin.copyEntitlements(dto, user.id);
  }

  @Patch('entitlements/:planId/:capabilityKey')
  updateEntitlement(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Param('capabilityKey') capabilityKey: string,
    @Body() dto: UpdateEntitlementDto,
    @CurrentUser() user: RequestUser,
  ): Promise<EntitlementCell> {
    return this.monetizationAdmin.upsertEntitlement(planId, capabilityKey, dto, user.id);
  }
}
