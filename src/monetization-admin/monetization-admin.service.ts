import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { BillingService } from '../billing/billing.service';
import { BillingWebhookService } from '../billing/billing-webhook.service';
import { BulkEnableReadonlyDto } from './dto/bulk-enable-readonly.dto';
import { CopyEntitlementsDto } from './dto/copy-entitlements.dto';
import { ListOrgSubscriptionsQueryDto } from './dto/list-org-subscriptions-query.dto';
import { ListPlansQueryDto } from './dto/list-plans-query.dto';
import { ListStripeEventsQueryDto } from './dto/list-stripe-events-query.dto';
import { PreviewEntitlementDto } from './dto/preview-entitlement.dto';
import { UpdateEntitlementDto } from './dto/update-entitlement.dto';
import type {
  AiCapabilityRow,
  BulkEnableReadonlyResult,
  CopyEntitlementsResult,
  EntitlementCell,
  EntitlementsMatrixResponse,
  EntitlementMatrixRow,
  EntitlementPreviewResult,
  OrgSubscriptionDetailResponse,
  OrgSubscriptionListItem,
  RetryStripeEventResult,
  StripeEventLogDetail,
  StripeEventLogListItem,
  SubscriptionPlanAdminRow,
  SyncPlansFromStripeResult,
} from './monetization-admin.types';

const PLAN_ADMIN_SELECT =
  'id, plan_key, stripe_product_id, stripe_price_id, display_name, billing_interval, currency, amount_cents, pricing_model, seat_based_enabled, unit_amount_cents, is_active, created_at, updated_at';

const ENTITLEMENT_SELECT =
  'id, plan_id, capability_key, is_enabled, hard_block, quota_period, quota_limit, upsell_message, updated_at, updated_by_user_id';

const ENTITLEMENT_SELECT_WITHOUT_AUDIT_USER =
  'id, plan_id, capability_key, is_enabled, hard_block, quota_period, quota_limit, upsell_message, updated_at';

const PLACEHOLDER_STRIPE_MARKER = 'SEEDPH2REPLACE';

const ACTIVE_LIKE_SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'incomplete',
  'unpaid',
  'paused',
] as const;

const ORG_SUBSCRIPTION_LIST_SELECT = `
  id,
  organization_id,
  status,
  seat_quantity,
  current_period_end,
  stripe_customer_id,
  stripe_subscription_id,
  updated_at,
  organizations ( id, name, stripe_customer_id ),
  subscription_plans ( plan_key, display_name )
`;

const ORG_SUBSCRIPTION_DETAIL_SELECT = `
  id,
  organization_id,
  status,
  seat_quantity,
  price_per_seat_cents,
  current_period_start,
  current_period_end,
  trial_end,
  cancel_at_period_end,
  last_stripe_event_at,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_plans ( plan_key, display_name )
`;

type OrgJoin = { id: string; name: string; stripe_customer_id: string | null };
type PlanJoin = { plan_key: string; display_name: string | null };

type OrgSubscriptionListDbRow = {
  id: string;
  organization_id: string;
  status: string;
  seat_quantity: number;
  current_period_end: string | null;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  updated_at: string;
  organizations: OrgJoin | OrgJoin[] | null;
  subscription_plans: PlanJoin | PlanJoin[] | null;
};

type OrgSubscriptionDetailDbRow = {
  id: string;
  status: string;
  seat_quantity: number;
  price_per_seat_cents: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  last_stripe_event_at: string | null;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  subscription_plans: PlanJoin | PlanJoin[] | null;
};

type EntitlementDbRow = {
  id: string;
  plan_id: string;
  capability_key: string;
  is_enabled: boolean;
  hard_block: boolean;
  quota_period: EntitlementCell['quota_period'];
  quota_limit: number | null;
  upsell_message: string | null;
  updated_at: string;
  updated_by_user_id: string | null;
};

const STRIPE_EVENT_LOG_LIST_SELECT =
  'id, stripe_event_id, event_type, status, received_at, processed_at, error_message';

@Injectable()
export class MonetizationAdminService {
  private readonly logger = new Logger(MonetizationAdminService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly billingService: BillingService,
    private readonly billingWebhookService: BillingWebhookService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private getDb(): SupabaseClient {
    if (!this.adminClient) {
      throw new ServiceUnavailableException('Database client is not configured');
    }
    return this.adminClient;
  }

  async listPlans(query: ListPlansQueryDto): Promise<SubscriptionPlanAdminRow[]> {
    let builder = this.getDb()
      .from('subscription_plans')
      .select(PLAN_ADMIN_SELECT)
      .order('display_name', { ascending: true });

    if (query.active === true) {
      builder = builder.eq('is_active', true);
    } else if (query.active === false) {
      builder = builder.eq('is_active', false);
    }

    const { data, error } = await builder;

    if (error) {
      this.logger.error(`subscription_plans list failed: ${error.message}`);
      throw new BadRequestException('Could not load subscription plans');
    }

    return (data ?? []) as SubscriptionPlanAdminRow[];
  }

  async syncPlansFromStripe(): Promise<SyncPlansFromStripeResult> {
    const stripe = this.billingService.getStripe();
    const plans = await this.listPlans({});

    const result: SyncPlansFromStripeResult = {
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: [],
    };

    for (const plan of plans) {
      if (this.isPlaceholderStripeId(plan.stripe_price_id) || this.isPlaceholderStripeId(plan.stripe_product_id)) {
        result.skipped += 1;
        continue;
      }

      try {
        const price = await stripe.prices.retrieve(plan.stripe_price_id, {
          expand: ['product'],
        });

        const product =
          price.product && typeof price.product !== 'string' ? price.product : null;
        const productName =
          product && 'name' in product && typeof product.name === 'string'
            ? product.name
            : null;

        const billingInterval = price.recurring?.interval ?? plan.billing_interval;
        const unitAmount = price.unit_amount ?? plan.unit_amount_cents;
        const pricingModel =
          price.recurring?.usage_type === 'licensed' &&
          (plan.pricing_model === 'per_seat' || plan.seat_based_enabled)
            ? 'per_seat'
            : plan.pricing_model;

        const patch = {
          display_name: productName ?? plan.display_name,
          billing_interval: billingInterval,
          currency: price.currency ?? plan.currency,
          amount_cents: unitAmount,
          unit_amount_cents: unitAmount,
          pricing_model: pricingModel,
          seat_based_enabled: pricingModel === 'per_seat',
          is_active: price.active,
        };

        const changed =
          patch.display_name !== plan.display_name ||
          patch.billing_interval !== plan.billing_interval ||
          patch.currency !== plan.currency ||
          patch.amount_cents !== plan.amount_cents ||
          patch.unit_amount_cents !== plan.unit_amount_cents ||
          patch.pricing_model !== plan.pricing_model ||
          patch.seat_based_enabled !== plan.seat_based_enabled ||
          patch.is_active !== plan.is_active;

        if (!changed) {
          result.unchanged += 1;
          continue;
        }

        const { error } = await this.getDb()
          .from('subscription_plans')
          .update(patch)
          .eq('id', plan.id);

        if (error) {
          result.errors.push({
            plan_key: plan.plan_key,
            message: error.message,
          });
          continue;
        }

        result.updated += 1;
      } catch (err) {
        const message =
          err instanceof Stripe.errors.StripeError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Unknown error';
        result.errors.push({ plan_key: plan.plan_key, message });
      }
    }

    return result;
  }

  private isPlaceholderStripeId(value: string): boolean {
    return value.includes(PLACEHOLDER_STRIPE_MARKER);
  }

  async getEntitlementsMatrix(): Promise<EntitlementsMatrixResponse> {
    const plans = await this.listPlans({ active: true });
    const planIds = plans.map((p) => p.id);

    const { data: capabilities, error: capError } = await this.getDb()
      .from('ai_capabilities')
      .select(
        'capability_key, display_name, description, is_mutating, default_requires_confirmation',
      )
      .order('capability_key', { ascending: true });

    if (capError) {
      this.logger.error(`ai_capabilities list failed: ${capError.message}`);
      throw new BadRequestException('Could not load AI capabilities');
    }

    const capabilityRows = (capabilities ?? []) as AiCapabilityRow[];

    let entitlementRows: EntitlementDbRow[] = [];
    if (planIds.length > 0) {
      const primary = await this.getDb()
        .from('subscription_plan_entitlements')
        .select(ENTITLEMENT_SELECT)
        .in('plan_id', planIds);

      let listError = primary.error;
      let listRows: Array<Record<string, unknown>> = (primary.data ?? []) as Array<
        Record<string, unknown>
      >;

      if (listError && this.isMissingUpdatedByUserColumn(listError)) {
        const fallback = await this.getDb()
          .from('subscription_plan_entitlements')
          .select(ENTITLEMENT_SELECT_WITHOUT_AUDIT_USER)
          .in('plan_id', planIds);
        listError = fallback.error;
        listRows = (fallback.data ?? []) as Array<Record<string, unknown>>;
      }

      if (listError) {
        this.logger.error(`subscription_plan_entitlements list failed: ${listError.message}`);
        throw new BadRequestException('Could not load plan entitlements');
      }
      entitlementRows = listRows.map((row) => ({
        ...(row as EntitlementDbRow),
        updated_by_user_id: (row.updated_by_user_id as string | null | undefined) ?? null,
      }));
    }

    const entitlementByPlanCap = new Map<string, EntitlementDbRow>();
    for (const row of entitlementRows) {
      entitlementByPlanCap.set(`${row.plan_id}:${row.capability_key}`, row);
    }

    const rows: EntitlementMatrixRow[] = capabilityRows.map((cap) => ({
      capability_key: cap.capability_key,
      display_name: cap.display_name,
      description: cap.description,
      is_mutating: cap.is_mutating,
      cells: plans.map((plan) => {
        const existing = entitlementByPlanCap.get(`${plan.id}:${cap.capability_key}`);
        if (existing) {
          return this.toEntitlementCell(existing);
        }
        return {
          id: null,
          plan_id: plan.id,
          capability_key: cap.capability_key,
          is_enabled: false,
          hard_block: false,
          quota_period: null,
          quota_limit: null,
          upsell_message: null,
          updated_at: null,
          updated_by_user_id: null,
        };
      }),
    }));

    return { plans, rows };
  }

  async upsertEntitlement(
    planId: string,
    capabilityKey: string,
    dto: UpdateEntitlementDto,
    userId?: string,
  ): Promise<EntitlementCell> {
    await this.assertPlanExists(planId);
    await this.assertCapabilityExists(capabilityKey);

    const { data: existing, error: existingError } = await this.getDb()
      .from('subscription_plan_entitlements')
      .select(ENTITLEMENT_SELECT)
      .eq('plan_id', planId)
      .eq('capability_key', capabilityKey)
      .maybeSingle();

    if (existingError) {
      this.logger.error(`entitlement lookup failed: ${existingError.message}`);
      throw new BadRequestException('Could not load entitlement');
    }

    const prior = existing as EntitlementDbRow | null;
    const payload: Record<string, unknown> = {
      plan_id: planId,
      capability_key: capabilityKey,
      is_enabled: dto.is_enabled,
      hard_block: dto.hard_block ?? prior?.hard_block ?? false,
      quota_period:
        dto.quota_period !== undefined ? dto.quota_period : (prior?.quota_period ?? null),
      quota_limit:
        dto.quota_limit !== undefined ? dto.quota_limit : (prior?.quota_limit ?? null),
      upsell_message:
        dto.upsell_message !== undefined ? dto.upsell_message : (prior?.upsell_message ?? null),
    };
    if (userId) {
      payload.updated_by_user_id = userId;
    }

    if (payload.quota_period && payload.quota_limit == null) {
      throw new BadRequestException('quota_limit is required when quota_period is set');
    }

    const primaryUpsert = await this.getDb()
      .from('subscription_plan_entitlements')
      .upsert(payload, { onConflict: 'plan_id,capability_key' })
      .select(ENTITLEMENT_SELECT)
      .single();

    let upsertError = primaryUpsert.error;
    let upsertRow: Record<string, unknown> | null =
      (primaryUpsert.data as Record<string, unknown> | null) ?? null;

    if (upsertError && userId && this.isMissingUpdatedByUserColumn(upsertError)) {
      this.logger.warn(
        'updated_by_user_id column missing; saving entitlement without editor audit',
      );
      const payloadWithoutAudit = { ...payload };
      delete payloadWithoutAudit.updated_by_user_id;
      const fallbackUpsert = await this.getDb()
        .from('subscription_plan_entitlements')
        .upsert(payloadWithoutAudit, { onConflict: 'plan_id,capability_key' })
        .select(ENTITLEMENT_SELECT_WITHOUT_AUDIT_USER)
        .single();
      upsertError = fallbackUpsert.error;
      upsertRow = (fallbackUpsert.data as Record<string, unknown> | null) ?? null;
    }

    if (upsertError) {
      this.logger.error(`entitlement upsert failed: ${upsertError.message}`);
      throw new BadRequestException('Could not save entitlement');
    }

    return this.toEntitlementCell({
      ...(upsertRow as EntitlementDbRow),
      updated_by_user_id: (upsertRow?.updated_by_user_id as string | null | undefined) ?? null,
    });
  }

  private isMissingUpdatedByUserColumn(error: { message?: string }): boolean {
    const msg = (error.message ?? '').toLowerCase();
    return msg.includes('updated_by_user_id') && msg.includes('does not exist');
  }

  async bulkEnableReadonly(
    dto: BulkEnableReadonlyDto,
    userId?: string,
  ): Promise<BulkEnableReadonlyResult> {
    const plans = dto.plan_id
      ? [await this.getPlanById(dto.plan_id)]
      : await this.listPlans({ active: true });

    const { data: readonlyCaps, error: capError } = await this.getDb()
      .from('ai_capabilities')
      .select('capability_key')
      .eq('is_mutating', false);

    if (capError) {
      throw new BadRequestException('Could not load read-only capabilities');
    }

    const capabilityKeys = (readonlyCaps ?? []).map(
      (c: { capability_key: string }) => c.capability_key,
    );

    let entitlementsUpserted = 0;
    for (const plan of plans) {
      for (const capabilityKey of capabilityKeys) {
        await this.upsertEntitlement(plan.id, capabilityKey, { is_enabled: true }, userId);
        entitlementsUpserted += 1;
      }
    }

    return {
      plans_updated: plans.length,
      entitlements_upserted: entitlementsUpserted,
    };
  }

  async copyEntitlements(
    dto: CopyEntitlementsDto,
    userId?: string,
  ): Promise<CopyEntitlementsResult> {
    if (dto.source_plan_id === dto.target_plan_id) {
      throw new BadRequestException('Source and target plan must differ');
    }

    await this.assertPlanExists(dto.source_plan_id);
    await this.assertPlanExists(dto.target_plan_id);

    const { data: sourceRows, error: sourceError } = await this.getDb()
      .from('subscription_plan_entitlements')
      .select(ENTITLEMENT_SELECT)
      .eq('plan_id', dto.source_plan_id);

    if (sourceError) {
      throw new BadRequestException('Could not load source plan entitlements');
    }

    const { error: deleteError } = await this.getDb()
      .from('subscription_plan_entitlements')
      .delete()
      .eq('plan_id', dto.target_plan_id);

    if (deleteError) {
      throw new BadRequestException('Could not clear target plan entitlements');
    }

    const source = (sourceRows ?? []) as EntitlementDbRow[];
    if (source.length === 0) {
      return { entitlements_copied: 0 };
    }

    const inserts = source.map((row) => ({
      plan_id: dto.target_plan_id,
      capability_key: row.capability_key,
      is_enabled: row.is_enabled,
      hard_block: row.hard_block,
      quota_period: row.quota_period,
      quota_limit: row.quota_limit,
      upsell_message: row.upsell_message,
      ...(userId ? { updated_by_user_id: userId } : {}),
    }));

    const { error: insertError } = await this.getDb()
      .from('subscription_plan_entitlements')
      .insert(inserts);

    if (insertError) {
      this.logger.error(`entitlement copy failed: ${insertError.message}`);
      throw new BadRequestException('Could not copy entitlements to target plan');
    }

    return { entitlements_copied: inserts.length };
  }

  private async assertPlanExists(planId: string): Promise<void> {
    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select('id')
      .eq('id', planId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException('Could not verify plan');
    }
    if (!data) {
      throw new NotFoundException('Subscription plan not found');
    }
  }

  private async getPlanById(planId: string): Promise<SubscriptionPlanAdminRow> {
    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select(PLAN_ADMIN_SELECT)
      .eq('id', planId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Subscription plan not found');
    }
    return data as SubscriptionPlanAdminRow;
  }

  private async assertCapabilityExists(capabilityKey: string): Promise<void> {
    const { data, error } = await this.getDb()
      .from('ai_capabilities')
      .select('capability_key')
      .eq('capability_key', capabilityKey)
      .maybeSingle();

    if (error) {
      throw new BadRequestException('Could not verify capability');
    }
    if (!data) {
      throw new NotFoundException(`Capability not found: ${capabilityKey}`);
    }
  }

  private toEntitlementCell(row: EntitlementDbRow): EntitlementCell {
    return {
      id: row.id,
      plan_id: row.plan_id,
      capability_key: row.capability_key,
      is_enabled: row.is_enabled,
      hard_block: row.hard_block,
      quota_period: row.quota_period,
      quota_limit: row.quota_limit,
      upsell_message: row.upsell_message,
      updated_at: row.updated_at,
      updated_by_user_id: row.updated_by_user_id ?? null,
    };
  }

  async searchOrganizationSubscriptions(
    query: ListOrgSubscriptionsQueryDto,
  ): Promise<OrgSubscriptionListItem[]> {
    const q = query.q?.trim() ?? '';
    const limit = 50;

    let organizationIds: string[] | null = null;

    if (q) {
      const esc = this.escapeIlikePattern(q);
      const pattern = `%${esc}%`;
      const idSet = new Set<string>();

      const { data: orgMatches, error: orgError } = await this.getDb()
        .from('organizations')
        .select('id')
        .or(`name.ilike.${pattern},stripe_customer_id.ilike.${pattern}`)
        .limit(100);

      if (orgError) {
        this.logger.error(`organizations search failed: ${orgError.message}`);
        throw new BadRequestException('Could not search organizations');
      }
      for (const row of orgMatches ?? []) {
        idSet.add((row as { id: string }).id);
      }

      const { data: subMatches, error: subError } = await this.getDb()
        .from('organization_subscriptions')
        .select('organization_id')
        .or(`stripe_customer_id.ilike.${pattern},stripe_subscription_id.ilike.${pattern}`)
        .limit(100);

      if (subError) {
        this.logger.error(`organization_subscriptions search failed: ${subError.message}`);
        throw new BadRequestException('Could not search subscriptions');
      }
      for (const row of subMatches ?? []) {
        idSet.add((row as { organization_id: string }).organization_id);
      }

      organizationIds = [...idSet];
      if (organizationIds.length === 0) {
        return [];
      }
    }

    let builder = this.getDb()
      .from('organization_subscriptions')
      .select(ORG_SUBSCRIPTION_LIST_SELECT)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (organizationIds) {
      builder = builder.in('organization_id', organizationIds);
    }

    const { data, error } = await builder;

    if (error) {
      this.logger.error(`organization_subscriptions list failed: ${error.message}`);
      throw new BadRequestException('Could not load organization subscriptions');
    }

    return ((data ?? []) as OrgSubscriptionListDbRow[]).map((row) =>
      this.toOrgSubscriptionListItem(row),
    );
  }

  async getOrganizationSubscriptionDetail(
    organizationId: string,
  ): Promise<OrgSubscriptionDetailResponse> {
    const { data: org, error: orgError } = await this.getDb()
      .from('organizations')
      .select('id, name, stripe_customer_id')
      .eq('id', organizationId)
      .maybeSingle();

    if (orgError) {
      throw new BadRequestException('Could not load organization');
    }
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const { data: activeLike, error: activeError } = await this.getDb()
      .from('organization_subscriptions')
      .select(ORG_SUBSCRIPTION_DETAIL_SELECT)
      .eq('organization_id', organizationId)
      .in('status', [...ACTIVE_LIKE_SUBSCRIPTION_STATUSES])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeError) {
      throw new BadRequestException('Could not load subscription');
    }

    let subscriptionRow = activeLike as OrgSubscriptionDetailDbRow | null;

    if (!subscriptionRow) {
      const { data: latest, error: latestError } = await this.getDb()
        .from('organization_subscriptions')
        .select(ORG_SUBSCRIPTION_DETAIL_SELECT)
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) {
        throw new BadRequestException('Could not load subscription');
      }
      subscriptionRow = latest as OrgSubscriptionDetailDbRow | null;
    }

    return {
      organization: {
        id: org.id,
        name: org.name,
        stripe_customer_id: org.stripe_customer_id,
      },
      subscription: subscriptionRow ? this.toOrgSubscriptionDetailBlock(subscriptionRow) : null,
    };
  }

  private escapeIlikePattern(raw: string): string {
    return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  }

  private firstRelation<T>(value: T | T[] | null | undefined): T | null {
    if (value == null) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }

  private toOrgSubscriptionListItem(row: OrgSubscriptionListDbRow): OrgSubscriptionListItem {
    const org = this.firstRelation(row.organizations);
    const plan = this.firstRelation(row.subscription_plans);

    return {
      organization_id: row.organization_id,
      organization_name: org?.name ?? 'Unknown organization',
      organization_stripe_customer_id: org?.stripe_customer_id ?? null,
      subscription_row_id: row.id,
      stripe_subscription_id: row.stripe_subscription_id,
      stripe_customer_id: row.stripe_customer_id,
      status: row.status,
      plan_key: plan?.plan_key ?? 'unknown',
      plan_display_name: plan?.display_name ?? null,
      seat_quantity: row.seat_quantity,
      current_period_end: row.current_period_end,
      updated_at: row.updated_at,
    };
  }

  private toOrgSubscriptionDetailBlock(
    row: OrgSubscriptionDetailDbRow,
  ): OrgSubscriptionDetailResponse['subscription'] {
    const plan = this.firstRelation(row.subscription_plans);
    return {
      id: row.id,
      status: row.status,
      seat_quantity: row.seat_quantity,
      price_per_seat_cents: row.price_per_seat_cents,
      current_period_start: row.current_period_start,
      current_period_end: row.current_period_end,
      trial_end: row.trial_end,
      cancel_at_period_end: row.cancel_at_period_end,
      last_stripe_event_at: row.last_stripe_event_at,
      stripe_customer_id: row.stripe_customer_id,
      stripe_subscription_id: row.stripe_subscription_id,
      plan: {
        plan_key: plan?.plan_key ?? 'unknown',
        display_name: plan?.display_name ?? null,
      },
    };
  }

  async listStripeEvents(query: ListStripeEventsQueryDto): Promise<StripeEventLogListItem[]> {
    const limit = query.limit ?? 50;
    let builder = this.getDb()
      .from('stripe_event_log')
      .select(STRIPE_EVENT_LOG_LIST_SELECT)
      .order('received_at', { ascending: false })
      .limit(limit);

    if (query.status) {
      builder = builder.eq('status', query.status);
    }
    if (query.event_type?.trim()) {
      builder = builder.eq('event_type', query.event_type.trim());
    }
    if (query.q?.trim()) {
      const esc = this.escapeIlikePattern(query.q.trim());
      const pattern = `%${esc}%`;
      builder = builder.or(
        `stripe_event_id.ilike.${pattern},event_type.ilike.${pattern}`,
      );
    }

    const { data, error } = await builder;

    if (error) {
      this.logger.error(`stripe_event_log list failed: ${error.message}`);
      throw new BadRequestException('Could not load Stripe event log');
    }

    return (data ?? []) as StripeEventLogListItem[];
  }

  async getStripeEventDetail(logId: string): Promise<StripeEventLogDetail> {
    const { data, error } = await this.getDb()
      .from('stripe_event_log')
      .select(`${STRIPE_EVENT_LOG_LIST_SELECT}, payload`)
      .eq('id', logId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException('Could not load Stripe event');
    }
    if (!data) {
      throw new NotFoundException('Stripe event log entry not found');
    }

    const row = data as StripeEventLogListItem & { payload: Record<string, unknown> };
    return {
      id: row.id,
      stripe_event_id: row.stripe_event_id,
      event_type: row.event_type,
      status: row.status,
      received_at: row.received_at,
      processed_at: row.processed_at,
      error_message: row.error_message,
      payload: row.payload ?? {},
    };
  }

  async retryStripeEvent(logId: string): Promise<RetryStripeEventResult> {
    await this.billingWebhookService.reprocessLoggedEvent(logId);
    const detail = await this.getStripeEventDetail(logId);
    return {
      id: detail.id,
      stripe_event_id: detail.stripe_event_id,
      status: detail.status,
      processed_at: detail.processed_at,
      error_message: detail.error_message,
    };
  }

  async previewEntitlement(dto: PreviewEntitlementDto): Promise<EntitlementPreviewResult> {
    const plan = await this.getPlanById(dto.plan_id);

    const { data: capability, error: capError } = await this.getDb()
      .from('ai_capabilities')
      .select('capability_key, display_name, description')
      .eq('capability_key', dto.capability_key)
      .maybeSingle();

    if (capError) {
      throw new BadRequestException('Could not load capability');
    }
    if (!capability) {
      throw new NotFoundException(`Capability not found: ${dto.capability_key}`);
    }

    const { data: entitlement, error: entError } = await this.getDb()
      .from('subscription_plan_entitlements')
      .select(ENTITLEMENT_SELECT)
      .eq('plan_id', dto.plan_id)
      .eq('capability_key', dto.capability_key)
      .maybeSingle();

    if (entError) {
      throw new BadRequestException('Could not load entitlement');
    }

    const entRow = entitlement as EntitlementDbRow | null;
    const capabilityInfo = capability as AiCapabilityRow;
    const defaultUpsell = `Upgrade your plan to access ${capabilityInfo.display_name}.`;

    const entitlementState = entRow
      ? {
          is_enabled: entRow.is_enabled,
          hard_block: entRow.hard_block,
          quota_period: entRow.quota_period,
          quota_limit: entRow.quota_limit,
          upsell_message: entRow.upsell_message,
        }
      : null;

    if (!entRow || !entRow.is_enabled) {
      return {
        allowed: false,
        reason: 'not_enabled',
        upsell_message: entRow?.upsell_message?.trim() || defaultUpsell,
        plan: {
          id: plan.id,
          plan_key: plan.plan_key,
          display_name: plan.display_name,
        },
        capability: {
          capability_key: capabilityInfo.capability_key,
          display_name: capabilityInfo.display_name,
          description: capabilityInfo.description,
        },
        entitlement: entitlementState,
      };
    }

    if (entRow.hard_block) {
      return {
        allowed: false,
        reason: 'hard_block',
        upsell_message: entRow.upsell_message?.trim() || defaultUpsell,
        plan: {
          id: plan.id,
          plan_key: plan.plan_key,
          display_name: plan.display_name,
        },
        capability: {
          capability_key: capabilityInfo.capability_key,
          display_name: capabilityInfo.display_name,
          description: capabilityInfo.description,
        },
        entitlement: entitlementState,
      };
    }

    if (entRow.quota_period && entRow.quota_limit != null) {
      return {
        allowed: true,
        reason: 'allowed_with_quota',
        upsell_message: null,
        plan: {
          id: plan.id,
          plan_key: plan.plan_key,
          display_name: plan.display_name,
        },
        capability: {
          capability_key: capabilityInfo.capability_key,
          display_name: capabilityInfo.display_name,
          description: capabilityInfo.description,
        },
        entitlement: entitlementState,
      };
    }

    return {
      allowed: true,
      reason: 'allowed',
      upsell_message: null,
      plan: {
        id: plan.id,
        plan_key: plan.plan_key,
        display_name: plan.display_name,
      },
      capability: {
        capability_key: capabilityInfo.capability_key,
        display_name: capabilityInfo.display_name,
        description: capabilityInfo.description,
      },
      entitlement: entitlementState,
    };
  }
}
