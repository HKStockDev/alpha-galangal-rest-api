import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { BillingPortalConfigService } from './billing-portal-config.service';
import {
  BillingPortalFlow,
  STRIPE_PLAN_PLACEHOLDER_MARKER,
  TRIAL_BLOCKING_SUBSCRIPTION_STATUSES,
  TRIAL_ENTRY_PLAN_KEY,
} from './billing.constants';
import {
  classifyPlanChange,
  PlanChangeKind,
  resolvePlanChangeStripeParams,
} from './billing-plan-change';
import { isPerSeatPlan, resolveSeatSyncStripeParams } from './billing-seat-sync';
import { CreditsService } from '../credits/credits.service';
import {
  computeBillingPeriodRemainingFraction,
  shouldDeferDowngradePlanChange,
  shouldDeferUpgradePlanChange,
} from '../credits/credit-subscription-sync';
import { TEAM_PLAN_MAX_SEATS } from './dto/create-checkout-session.dto';
import {
  BillingPlanCatalogItem,
  BillingSetupStatus,
  OrganizationBillingRow,
  OrganizationBillingStatus,
  SubscriptionPlanRow,
} from './billing.types';

const ENTITLED_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due'] as const;

const ACTIVE_LIKE_SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'incomplete',
  'unpaid',
  'paused',
] as const;

type StripeClient = InstanceType<typeof Stripe>;

const SUBSCRIPTION_PLAN_SELECT =
  'id, plan_key, stripe_product_id, stripe_price_id, display_name, billing_interval, currency, amount_cents, pricing_model, seat_based_enabled, unit_amount_cents, monthly_base_credits, is_active';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: StripeClient | null;
  private readonly adminClient: SupabaseClient | null;

  constructor(
    private readonly config: ConfigService,
    private readonly portalConfigService: BillingPortalConfigService,
    @Inject(forwardRef(() => CreditsService))
    private readonly creditsService: CreditsService,
  ) {
    const secretKey = this.config.get<string>('stripe.secretKey');
    this.stripe = secretKey ? new Stripe(secretKey, { typescript: true }) : null;
    if (!this.stripe) {
      this.logger.warn('STRIPE_SECRET_KEY is not set; billing routes will be unavailable');
    }

    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    this.adminClient =
      url && (serviceRoleKey || anonKey)
        ? createClient(url, serviceRoleKey ?? anonKey!)
        : null;
  }

  isStripeConfigured(): boolean {
    return this.stripe !== null;
  }

  /** Stripe SDK client; throws if STRIPE_SECRET_KEY is missing. */
  getStripe(): StripeClient {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Stripe is not configured');
    }
    return this.stripe;
  }

  getWebhookSecret(): string | undefined {
    return this.config.get<string>('stripe.webhookSecret');
  }

  requireWebhookSecret(): string {
    const secret = this.getWebhookSecret();
    if (!secret) {
      throw new ServiceUnavailableException('Stripe webhooks are not configured');
    }
    return secret;
  }

  getCheckoutSuccessUrl(): string {
    return this.config.getOrThrow<string>('stripe.checkoutSuccessUrl');
  }

  getCheckoutCancelUrl(): string {
    return this.config.getOrThrow<string>('stripe.checkoutCancelUrl');
  }

  getBillingPortalReturnUrl(): string {
    return this.config.getOrThrow<string>('stripe.billingPortalReturnUrl');
  }

  getTrialDays(): number {
    const raw = this.config.get<number>('stripe.trialDays');
    const days = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 14;
    return days > 0 ? days : 14;
  }

  /** CON-168: one free trial per organization for the lifetime of the org. */
  async markOrganizationTrialUsed(organizationId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.getDb()
      .from('organizations')
      .update({ trial_used_at: now })
      .eq('id', organizationId)
      .is('trial_used_at', null);

    if (error) {
      this.logger.error(`mark trial_used_at failed: ${error.message}`);
      throw new BadRequestException('Could not record trial usage');
    }
  }

  private async hasOrganizationConsumedTrial(organizationId: string): Promise<boolean> {
    const organization = await this.getOrganizationForBilling(organizationId);
    if (organization.trial_used_at?.trim()) {
      return true;
    }

    const { data, error } = await this.getDb()
      .from('organization_subscriptions')
      .select('id')
      .eq('organization_id', organizationId)
      .not('trial_end', 'is', null)
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`trial history check failed: ${error.message}`);
      throw new BadRequestException('Could not verify trial eligibility');
    }

    return Boolean(data?.id);
  }

  private async isFreeTrialAvailable(organizationId: string): Promise<boolean> {
    if (await this.hasOrganizationConsumedTrial(organizationId)) {
      return false;
    }

    const { data, error } = await this.getDb()
      .from('organization_subscriptions')
      .select('id')
      .eq('organization_id', organizationId)
      .in('status', [...TRIAL_BLOCKING_SUBSCRIPTION_STATUSES])
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`trial eligibility check failed: ${error.message}`);
      throw new BadRequestException('Could not verify trial eligibility');
    }

    return !data?.id;
  }

  private async assertEligibleForTrial(organizationId: string): Promise<void> {
    if (await this.hasOrganizationConsumedTrial(organizationId)) {
      throw new BadRequestException(
        'This organization has already used its free trial. Free trial is not available.',
      );
    }

    const { data, error } = await this.getDb()
      .from('organization_subscriptions')
      .select('id, status')
      .eq('organization_id', organizationId)
      .in('status', [...TRIAL_BLOCKING_SUBSCRIPTION_STATUSES])
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`trial eligibility check failed: ${error.message}`);
      throw new BadRequestException('Could not verify trial eligibility');
    }
    if (data?.id) {
      throw new BadRequestException(
        'This organization already has an active subscription. Free trial is not available.',
      );
    }
  }

  private getDb(): SupabaseClient {
    if (!this.adminClient) {
      throw new ServiceUnavailableException('Database client is not configured');
    }
    return this.adminClient;
  }

  private planTierFromKey(planKey: string): BillingPlanCatalogItem['tier'] {
    if (planKey.startsWith('team_')) return 'team';
    if (planKey.startsWith('enterprise_')) return 'enterprise';
    return 'professional';
  }

  async listBillingPlanCatalog(): Promise<BillingPlanCatalogItem[]> {
    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select(
        'plan_key, display_name, billing_interval, currency, amount_cents, unit_amount_cents, pricing_model, seat_based_enabled',
      )
      .eq('is_active', true)
      .order('plan_key', { ascending: true });

    if (error) {
      this.logger.error(`subscription_plans catalog failed: ${error.message}`);
      throw new BadRequestException('Could not load subscription plans');
    }

    return (data ?? []).map((row) => ({
      plan_key: row.plan_key as string,
      display_name: row.display_name as string | null,
      billing_interval: row.billing_interval as string | null,
      currency: row.currency as string | null,
      amount_cents: row.amount_cents as number | null,
      unit_amount_cents: row.unit_amount_cents as number | null,
      pricing_model: row.pricing_model as SubscriptionPlanRow['pricing_model'],
      seat_based_enabled: Boolean(row.seat_based_enabled),
      tier: this.planTierFromKey(row.plan_key as string),
    }));
  }

  async changeSubscriptionPlan(params: {
    organizationId: string;
    planKey: string;
    seatQuantity?: number;
  }): Promise<{
    updated: true;
    change_kind: PlanChangeKind;
    effective_at: 'immediate' | 'next_cycle';
  }> {
    const plan = await this.getActiveSubscriptionPlanByKey(params.planKey);
    this.assertStripePriceConfigured(plan);

    const stripeSubscriptionId = await this.getActiveStripeSubscriptionId(params.organizationId);
    if (!stripeSubscriptionId) {
      throw new BadRequestException(
        'No active subscription for this organization. Subscribe via checkout first.',
      );
    }

    const quantity = this.resolveCheckoutQuantity(plan, params.seatQuantity);
    const stripe = this.getStripe();
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const primaryItem = subscription.items.data[0];
    if (!primaryItem?.id) {
      throw new BadRequestException('Subscription has no billable line item');
    }

    const currentPriceId =
      typeof primaryItem.price === 'string' ? primaryItem.price : primaryItem.price?.id;
    const currentQuantity = primaryItem.quantity ?? 1;
    if (currentPriceId === plan.stripe_price_id && currentQuantity === quantity) {
      throw new BadRequestException('Organization is already on this plan');
    }

    if (!currentPriceId) {
      throw new BadRequestException('Subscription has no price on primary item');
    }

    const currentPlan = await this.findPlanByStripePriceId(currentPriceId);
    if (!currentPlan) {
      throw new BadRequestException(
        'Current subscription price is not mapped to an active plan in subscription_plans',
      );
    }

    const changeKind = classifyPlanChange(currentPlan, plan, currentQuantity, quantity);
    const policy = await this.creditsService.getPolicyConfig();

    if (
      shouldDeferDowngradePlanChange({
        changeKind,
        downgradeEffectiveMode: policy.downgrade_effective_mode,
      })
    ) {
      await stripe.subscriptions.update(stripeSubscriptionId, {
        metadata: {
          organization_id: params.organizationId,
          plan_key: currentPlan.plan_key,
          plan_id: currentPlan.id,
          pending_plan_id: plan.id,
          pending_plan_key: plan.plan_key,
          pending_seat_quantity: String(quantity),
          plan_change_deferred: 'downgrade_next_cycle',
        },
      });
      this.logger.log(
        `Plan change ${currentPlan.plan_key} -> ${plan.plan_key}: deferred until next billing cycle`,
      );
      return { updated: true, change_kind: changeKind, effective_at: 'next_cycle' as const };
    }

    if (
      shouldDeferUpgradePlanChange({
        changeKind,
        upgradeProrationMode: policy.upgrade_proration_mode,
      })
    ) {
      await stripe.subscriptions.update(stripeSubscriptionId, {
        metadata: {
          organization_id: params.organizationId,
          plan_key: currentPlan.plan_key,
          plan_id: currentPlan.id,
          pending_plan_id: plan.id,
          pending_plan_key: plan.plan_key,
          pending_seat_quantity: String(quantity),
          plan_change_deferred: 'upgrade_next_cycle',
        },
      });
      this.logger.log(
        `Plan change ${currentPlan.plan_key} -> ${plan.plan_key}: upgrade deferred until next billing cycle`,
      );
      return { updated: true, change_kind: changeKind, effective_at: 'next_cycle' as const };
    }

    const { proration_behavior, billing_cycle_anchor } =
      resolvePlanChangeStripeParams(changeKind);

    this.logger.log(
      `Plan change ${currentPlan.plan_key} -> ${plan.plan_key}: kind=${changeKind} proration=${proration_behavior} billing_cycle_anchor=${billing_cycle_anchor}`,
    );

    const isTrialing = subscription.status === 'trialing';

    const metadata: Record<string, string> = {
      organization_id: params.organizationId,
      plan_key: plan.plan_key,
      plan_id: plan.id,
      pending_plan_id: '',
      pending_plan_key: '',
      pending_seat_quantity: '',
      plan_change_deferred: '',
    };

    await stripe.subscriptions.update(stripeSubscriptionId, {
      items: [
        {
          id: primaryItem.id,
          price: plan.stripe_price_id,
          quantity,
        },
      ],
      proration_behavior,
      billing_cycle_anchor,
      ...(isTrialing ? { trial_end: 'now' as const } : {}),
      metadata: {
        ...metadata,
        plan_change_kind: changeKind,
        ...(isTrialing ? { trial_ended_early: 'plan_change' } : {}),
      },
    });

    await this.syncCreditsAfterImmediatePlanChange({
      organizationId: params.organizationId,
      currentPlan,
      targetPlan: plan,
      stripeSubscriptionId,
    });

    return { updated: true, change_kind: changeKind, effective_at: 'immediate' as const };
  }

  private async syncCreditsAfterImmediatePlanChange(params: {
    organizationId: string;
    currentPlan: SubscriptionPlanRow;
    targetPlan: SubscriptionPlanRow;
    stripeSubscriptionId: string;
  }): Promise<void> {
    const stripe = this.getStripe();
    const refreshed = await stripe.subscriptions.retrieve(params.stripeSubscriptionId, {
      expand: ['items.data.price'],
    });
    const primaryItem = refreshed.items.data[0];
    if (!primaryItem) {
      return;
    }

    const periodStart = primaryItem.current_period_start ?? null;
    const periodEnd = primaryItem.current_period_end ?? null;
    const prorateRemainingFraction =
      computeBillingPeriodRemainingFraction(periodStart, periodEnd) ?? undefined;

    const [previousMonthlyBase, targetMonthlyBase] = await Promise.all([
      this.getPlanMonthlyBaseCredits(params.currentPlan.id),
      this.getPlanMonthlyBaseCredits(params.targetPlan.id),
    ]);

    if (previousMonthlyBase === targetMonthlyBase) {
      return;
    }

    await this.creditsService.syncBaseCreditsFromSubscription({
      organizationId: params.organizationId,
      planId: params.targetPlan.id,
      periodStart: this.unixSecondsToIso(periodStart),
      periodEnd: this.unixSecondsToIso(periodEnd),
      isNewPeriod: false,
      prorateRemainingFraction,
      previousPlanMonthlyBase: previousMonthlyBase,
      planChanged: true,
    });
  }

  private unixSecondsToIso(unix: number | null): string | null {
    if (unix == null) {
      return null;
    }
    return new Date(unix * 1000).toISOString();
  }

  private async getPlanMonthlyBaseCredits(planId: string): Promise<number> {
    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select('monthly_base_credits')
      .eq('id', planId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data?.monthly_base_credits as number) ?? 0;
  }

  /**
   * Applies a downgrade scheduled via pending_plan_* metadata at the start of a new period.
   */
  async applyDeferredSubscriptionPlanChange(
    subscription: Awaited<ReturnType<StripeClient['subscriptions']['retrieve']>>,
  ): Promise<Awaited<ReturnType<StripeClient['subscriptions']['retrieve']>>> {
    const pendingPlanId = subscription.metadata?.pending_plan_id?.trim();
    if (!pendingPlanId) {
      return subscription;
    }

    const plan = await this.getActiveSubscriptionPlanById(pendingPlanId);
    this.assertStripePriceConfigured(plan);

    const stripe = this.getStripe();
    const primaryItem = subscription.items.data[0];
    if (!primaryItem?.id) {
      return subscription;
    }

    const qtyRaw = subscription.metadata?.pending_seat_quantity;
    const parsedQty = qtyRaw ? Number(qtyRaw) : NaN;
    const quantity = this.resolveCheckoutQuantity(
      plan,
      Number.isFinite(parsedQty) && parsedQty >= 1 ? parsedQty : undefined,
    );

    const organizationId = subscription.metadata?.organization_id ?? '';

    await stripe.subscriptions.update(subscription.id, {
      items: [
        {
          id: primaryItem.id,
          price: plan.stripe_price_id,
          quantity,
        },
      ],
      proration_behavior: 'none',
      billing_cycle_anchor: 'unchanged',
      metadata: {
        organization_id: organizationId,
        plan_key: plan.plan_key,
        plan_id: plan.id,
        pending_plan_id: '',
        pending_plan_key: '',
        pending_seat_quantity: '',
        plan_change_deferred: '',
      },
    });

    return stripe.subscriptions.retrieve(subscription.id, {
      expand: ['items.data.price'],
    });
  }

  /** End trial immediately and bill the current plan (optional early conversion). */
  async endSubscriptionTrialEarly(organizationId: string): Promise<{ updated: true }> {
    const stripeSubscriptionId = await this.getActiveStripeSubscriptionId(organizationId);
    if (!stripeSubscriptionId) {
      throw new BadRequestException(
        'No active subscription for this organization. Subscribe via checkout first.',
      );
    }

    const stripe = this.getStripe();
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    if (subscription.status !== 'trialing') {
      throw new BadRequestException('No trial is in progress on this subscription.');
    }

    await stripe.subscriptions.update(stripeSubscriptionId, {
      trial_end: 'now',
      metadata: {
        organization_id: organizationId,
        trial_ended_early: 'user_request',
      },
    });

    return { updated: true };
  }

  /**
   * CON-100 / CON-101: Align Stripe subscription quantity with active org members on per-seat plans
   * (increment on invite accept, decrement on member removal).
   * No-op for flat plans or orgs without an active subscription.
   */
  async syncSubscriptionSeatsToMemberCount(
    organizationId: string,
  ): Promise<{ updated: boolean; quantity?: number }> {
    if (!this.isStripeConfigured()) {
      return { updated: false };
    }

    const context = await this.getActiveSubscriptionPlanContext(organizationId);
    if (!context) {
      return { updated: false };
    }

    const { plan, stripeSubscriptionId } = context;
    if (!isPerSeatPlan(plan)) {
      return { updated: false };
    }

    const memberCount = await this.countActiveOrganizationMembers(organizationId);
    if (memberCount > TEAM_PLAN_MAX_SEATS) {
      throw new BadRequestException(
        `Team plan supports up to ${TEAM_PLAN_MAX_SEATS} active members`,
      );
    }

    const targetQuantity = Math.max(1, memberCount);
    const stripe = this.getStripe();
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const primaryItem = subscription.items.data[0];
    if (!primaryItem?.id) {
      throw new BadRequestException('Subscription has no billable line item');
    }

    const currentQuantity = primaryItem.quantity ?? 1;
    if (targetQuantity === currentQuantity) {
      return { updated: false, quantity: targetQuantity };
    }

    const priceId =
      typeof primaryItem.price === 'string' ? primaryItem.price : primaryItem.price?.id;
    if (!priceId || priceId !== plan.stripe_price_id) {
      throw new BadRequestException(
        'Subscription price does not match the active plan; use billing settings to change plan first',
      );
    }

    const { changeKind, stripeParams } = resolveSeatSyncStripeParams(
      plan,
      currentQuantity,
      targetQuantity,
    );

    this.logger.log(
      `Seat sync org=${organizationId}: quantity ${currentQuantity} -> ${targetQuantity} kind=${changeKind}`,
    );

    await stripe.subscriptions.update(stripeSubscriptionId, {
      items: [
        {
          id: primaryItem.id,
          price: plan.stripe_price_id,
          quantity: targetQuantity,
        },
      ],
      proration_behavior: stripeParams.proration_behavior,
      billing_cycle_anchor: stripeParams.billing_cycle_anchor,
      metadata: {
        organization_id: organizationId,
        plan_key: plan.plan_key,
        plan_id: plan.id,
        plan_change_kind: changeKind,
        seat_sync: 'con_100',
      },
    });

    return { updated: true, quantity: targetQuantity };
  }

  /** Block new invites when Team seat cap would be exceeded after pending accepts. */
  async assertCanInviteTeamMember(organizationId: string): Promise<void> {
    const context = await this.getActiveSubscriptionPlanContext(organizationId);
    if (!context || !isPerSeatPlan(context.plan)) {
      return;
    }

    const [activeMembers, pendingInvites] = await Promise.all([
      this.countActiveOrganizationMembers(organizationId),
      this.countPendingOrganizationInvitations(organizationId),
    ]);

    if (activeMembers + pendingInvites >= TEAM_PLAN_MAX_SEATS) {
      throw new BadRequestException(
        `Team plan supports up to ${TEAM_PLAN_MAX_SEATS} members including pending invitations`,
      );
    }
  }

  async countActiveOrganizationMembers(organizationId: string): Promise<number> {
    const { count, error } = await this.getDb()
      .from('organization_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'active');

    if (error) {
      this.logger.error(`organization_memberships count failed: ${error.message}`);
      throw new BadRequestException('Could not count organization members');
    }

    return count ?? 0;
  }

  private async countPendingOrganizationInvitations(organizationId: string): Promise<number> {
    const { count, error } = await this.getDb()
      .from('organization_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'pending');

    if (error) {
      this.logger.error(`organization_invitations count failed: ${error.message}`);
      throw new BadRequestException('Could not count pending invitations');
    }

    return count ?? 0;
  }

  private async getActiveSubscriptionPlanContext(
    organizationId: string,
  ): Promise<{ stripeSubscriptionId: string; plan: SubscriptionPlanRow } | null> {
    const { data, error } = await this.getDb()
      .from('organization_subscriptions')
      .select(
        `
        stripe_subscription_id,
        subscription_plans (
          ${SUBSCRIPTION_PLAN_SELECT}
        )
      `,
      )
      .eq('organization_id', organizationId)
      .in('status', [...ACTIVE_LIKE_SUBSCRIPTION_STATUSES])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`organization_subscriptions plan lookup failed: ${error.message}`);
      throw new BadRequestException('Could not load subscription for seat sync');
    }

    if (!data?.stripe_subscription_id) {
      return null;
    }

    const rawPlan = data.subscription_plans as SubscriptionPlanRow | SubscriptionPlanRow[] | null;
    const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
    if (!plan) {
      return null;
    }

    return {
      stripeSubscriptionId: data.stripe_subscription_id.trim(),
      plan: plan as SubscriptionPlanRow,
    };
  }

  private async findPlanByStripePriceId(priceId: string): Promise<SubscriptionPlanRow | null> {
    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select(SUBSCRIPTION_PLAN_SELECT)
      .eq('stripe_price_id', priceId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      this.logger.error(`subscription_plans lookup by price failed: ${error.message}`);
      throw new BadRequestException('Could not load current subscription plan');
    }

    return (data as SubscriptionPlanRow | null) ?? null;
  }

  async getActiveSubscriptionPlanById(planId: string): Promise<SubscriptionPlanRow> {
    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select(SUBSCRIPTION_PLAN_SELECT)
      .eq('id', planId.trim())
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException(`Subscription plan not found: ${planId}`);
    }
    return data as SubscriptionPlanRow;
  }

  async getActiveSubscriptionPlanByKey(planKey: string): Promise<SubscriptionPlanRow> {
    const normalized = planKey.trim();
    if (!normalized) {
      throw new BadRequestException('plan_key is required');
    }

    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select(SUBSCRIPTION_PLAN_SELECT)
      .eq('plan_key', normalized)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      this.logger.error(`subscription_plans lookup failed: ${error.message}`);
      throw new BadRequestException('Could not load subscription plan');
    }
    if (!data) {
      throw new NotFoundException(`Subscription plan not found: ${normalized}`);
    }

    return data as SubscriptionPlanRow;
  }

  async getOrganizationForBilling(organizationId: string): Promise<OrganizationBillingRow> {
    const { data, error } = await this.getDb()
      .from('organizations')
      .select('id, name, stripe_customer_id, trial_used_at')
      .eq('id', organizationId)
      .maybeSingle();

    if (error) {
      this.logger.error(`organizations lookup failed: ${error.message}`);
      throw new BadRequestException('Could not load organization');
    }
    if (!data) {
      throw new NotFoundException('Organization not found');
    }

    return data as OrganizationBillingRow;
  }

  async setOrganizationStripeCustomerId(
    organizationId: string,
    stripeCustomerId: string,
  ): Promise<void> {
    const { error } = await this.getDb()
      .from('organizations')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('id', organizationId);

    if (error) {
      this.logger.error(`organizations stripe_customer_id update failed: ${error.message}`);
      throw new BadRequestException('Could not save Stripe customer for organization');
    }
  }

  isPlanStripePlaceholder(plan: Pick<SubscriptionPlanRow, 'stripe_price_id' | 'stripe_product_id'>): boolean {
    return (
      plan.stripe_price_id.includes(STRIPE_PLAN_PLACEHOLDER_MARKER) ||
      plan.stripe_product_id.includes(STRIPE_PLAN_PLACEHOLDER_MARKER)
    );
  }

  async getBillingSetupStatus(): Promise<BillingSetupStatus> {
    const stripeSecret = Boolean(this.config.get<string>('stripe.secretKey')?.trim());
    const webhookSecret = Boolean(this.config.get<string>('stripe.webhookSecret')?.trim());
    const checkoutUrls =
      Boolean(this.config.get<string>('stripe.checkoutSuccessUrl')?.trim()) &&
      Boolean(this.config.get<string>('stripe.checkoutCancelUrl')?.trim()) &&
      Boolean(this.config.get<string>('stripe.billingPortalReturnUrl')?.trim());

    const blockers: string[] = [];
    if (!stripeSecret) {
      blockers.push('Set STRIPE_SECRET_KEY (sk_test_ or sk_live_).');
    }
    if (!webhookSecret) {
      blockers.push('Set STRIPE_WEBHOOK_SECRET (whsec_...) and register POST /billing/webhook in Stripe.');
    }
    if (!checkoutUrls) {
      blockers.push(
        'Set STRIPE_CHECKOUT_SUCCESS_URL, STRIPE_CHECKOUT_CANCEL_URL, and STRIPE_BILLING_PORTAL_RETURN_URL (or FRONTEND_URL).',
      );
    }

    let activePlanCount = 0;
    const placeholderPlanKeys: string[] = [];

    if (this.adminClient) {
      const { data, error } = await this.getDb()
        .from('subscription_plans')
        .select('plan_key, stripe_product_id, stripe_price_id')
        .eq('is_active', true);

      if (error) {
        this.logger.error(`subscription_plans setup scan failed: ${error.message}`);
        blockers.push('Could not read subscription_plans from database.');
      } else if (data) {
        activePlanCount = data.length;
        for (const row of data) {
          if (this.isPlanStripePlaceholder(row as SubscriptionPlanRow)) {
            placeholderPlanKeys.push(row.plan_key as string);
          }
        }
      }
    } else {
      blockers.push('Database client is not configured.');
    }

    if (activePlanCount === 0) {
      blockers.push('No active rows in subscription_plans — run billing migrations.');
    }
    if (placeholderPlanKeys.length > 0) {
      blockers.push(
        `Replace placeholder Stripe ids for plan_key: ${placeholderPlanKeys.join(', ')} (see migration 20260516150000).`,
      );
    }

    let portalConfigurationId: string | null = null;
    let portalSubscriptionUpdateEnabled = false;
    let portalProductCount = 0;
    let portalPriceCount = 0;

    if (stripeSecret && placeholderPlanKeys.length === 0 && activePlanCount > 0) {
      try {
        const syncResult = await this.portalConfigService.syncFromDatabasePlans(this.getStripe());
        portalConfigurationId = syncResult.configuration_id;
        portalProductCount = syncResult.product_count;
        portalPriceCount = syncResult.price_count;
        portalSubscriptionUpdateEnabled = false;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        blockers.push(`Stripe portal catalog sync failed: ${message}`);
      }
    } else if (stripeSecret && placeholderPlanKeys.length > 0) {
      blockers.push(
        'Portal plan switching requires real Stripe ids on all active subscription_plans (POST /billing/setup/sync-portal after fixing).',
      );
    }

    const portalSwitchReady =
      stripeSecret && placeholderPlanKeys.length === 0 && activePlanCount >= 2;

    if (stripeSecret && placeholderPlanKeys.length === 0 && activePlanCount < 2) {
      blockers.push(
        'Need at least 2 active subscription_plans for in-app plan switching (POST /organizations/:id/billing/change-plan).',
      );
    }

    const checkoutReady =
      stripeSecret && placeholderPlanKeys.length === 0 && activePlanCount > 0 && checkoutUrls;

    return {
      stripe_secret_key_configured: stripeSecret,
      stripe_webhook_secret_configured: webhookSecret,
      checkout_urls_configured: checkoutUrls,
      active_plan_count: activePlanCount,
      plans_with_placeholder_stripe_ids: placeholderPlanKeys,
      checkout_ready: checkoutReady,
      webhook_ready: stripeSecret && webhookSecret,
      portal_configuration_id: portalConfigurationId,
      portal_subscription_update_enabled: portalSubscriptionUpdateEnabled,
      portal_product_count: portalProductCount,
      portal_price_count: portalPriceCount,
      portal_switch_ready: portalSwitchReady,
      blockers,
    };
  }

  async syncPortalConfigurationFromPlans() {
    const stripe = this.getStripe();
    const main = await this.portalConfigService.syncFromDatabasePlans(stripe);
    const invoiceHistory =
      await this.portalConfigService.syncInvoiceHistoryConfiguration(stripe);
    return {
      ...main,
      invoice_history_configuration_id: invoiceHistory.configuration_id,
    };
  }

  private assertStripePriceConfigured(plan: SubscriptionPlanRow): void {
    if (this.isPlanStripePlaceholder(plan)) {
      throw new BadRequestException(
        `Plan "${plan.plan_key}" is not linked to Stripe yet. Update subscription_plans with real price and product IDs.`,
      );
    }
  }

  private resolveCheckoutQuantity(
    plan: SubscriptionPlanRow,
    seatQuantity: number | undefined,
  ): number {
    if (plan.pricing_model === 'per_seat' || plan.seat_based_enabled) {
      const quantity = seatQuantity ?? 1;
      if (quantity < 1 || quantity > TEAM_PLAN_MAX_SEATS) {
        throw new BadRequestException(
          `seat_quantity must be between 1 and ${TEAM_PLAN_MAX_SEATS} for team plans`,
        );
      }
      return quantity;
    }
    if (seatQuantity != null && seatQuantity !== 1) {
      throw new BadRequestException('seat_quantity is only used for per-seat plans');
    }
    return 1;
  }

  private async resolveStripeCustomerId(
    organization: OrganizationBillingRow,
    billingEmail: string,
  ): Promise<string> {
    const stripe = this.getStripe();

    if (organization.stripe_customer_id) {
      try {
        await stripe.customers.update(organization.stripe_customer_id, {
          metadata: { organization_id: organization.id },
        });
      } catch (err) {
        this.logger.warn(
          `Stripe customer metadata update failed for ${organization.stripe_customer_id}: ${err instanceof Error ? err.message : err}`,
        );
      }
      return organization.stripe_customer_id;
    }

    const customer = await stripe.customers.create({
      email: billingEmail,
      name: organization.name,
      metadata: { organization_id: organization.id },
    });

    await this.setOrganizationStripeCustomerId(organization.id, customer.id);
    return customer.id;
  }

  async createCheckoutSession(params: {
    organizationId: string;
    planKey: string;
    seatQuantity?: number;
    billingEmail: string;
    startTrial?: boolean;
  }): Promise<{ url: string; sessionId: string }> {
    const startTrial = params.startTrial === true;
    const planKey = startTrial ? TRIAL_ENTRY_PLAN_KEY : params.planKey.trim();

    if (startTrial && params.planKey.trim() !== TRIAL_ENTRY_PLAN_KEY) {
      throw new BadRequestException(
        `Free trial checkout must use plan_key "${TRIAL_ENTRY_PLAN_KEY}".`,
      );
    }

    if (startTrial) {
      await this.assertEligibleForTrial(params.organizationId);
    } else {
      const existingSubscriptionId = await this.getActiveStripeSubscriptionId(
        params.organizationId,
      );
      if (existingSubscriptionId) {
        throw new BadRequestException(
          'This organization already has a subscription. Change plan or end your trial in billing settings.',
        );
      }
    }

    const plan = await this.getActiveSubscriptionPlanByKey(planKey);
    this.assertStripePriceConfigured(plan);

    const organization = await this.getOrganizationForBilling(params.organizationId);
    const quantity = this.resolveCheckoutQuantity(plan, params.seatQuantity);
    const stripeCustomerId = await this.resolveStripeCustomerId(organization, params.billingEmail);

    const stripe = this.getStripe();
    const metadata = {
      organization_id: params.organizationId,
      plan_key: plan.plan_key,
      plan_id: plan.id,
      ...(startTrial ? { checkout_flow: 'trial' } : {}),
    };

    const trialDays = startTrial ? this.getTrialDays() : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      client_reference_id: params.organizationId,
      line_items: [
        {
          price: plan.stripe_price_id,
          quantity,
        },
      ],
      success_url: this.getCheckoutSuccessUrl(),
      cancel_url: this.getCheckoutCancelUrl(),
      metadata,
      ...(startTrial ? { payment_method_collection: 'always' as const } : {}),
      subscription_data: {
        metadata,
        ...(trialDays != null ? { trial_period_days: trialDays } : {}),
      },
    });

    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL');
    }

    return { url: session.url, sessionId: session.id };
  }

  /** Platform admins are always entitled; they do not purchase org subscriptions. */
  getPlatformAdminBillingStatus(organizationId: string): OrganizationBillingStatus {
    return {
      organization_id: organizationId,
      has_stripe_customer: false,
      subscription: null,
      is_entitled: true,
      can_manage_in_stripe: false,
      free_trial_available: false,
    };
  }

  async getOrganizationBillingStatus(
    organizationId: string,
  ): Promise<OrganizationBillingStatus> {
    const organization = await this.getOrganizationForBilling(organizationId);
    const hasStripeCustomer = Boolean(organization.stripe_customer_id?.trim());

    const { data, error } = await this.getDb()
      .from('organization_subscriptions')
      .select(
        `
        status,
        seat_quantity,
        current_period_end,
        trial_end,
        cancel_at_period_end,
        subscription_plans (
          plan_key,
          display_name
        )
      `,
      )
      .eq('organization_id', organizationId)
      .in('status', [...ACTIVE_LIKE_SUBSCRIPTION_STATUSES])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`organization_subscriptions lookup failed: ${error.message}`);
      throw new BadRequestException('Could not load subscription status');
    }

    const freeTrialAvailable = await this.isFreeTrialAvailable(organizationId);

    if (!data) {
      return {
        organization_id: organizationId,
        has_stripe_customer: hasStripeCustomer,
        subscription: null,
        is_entitled: false,
        can_manage_in_stripe: hasStripeCustomer,
        free_trial_available: freeTrialAvailable,
      };
    }

    const plan = data.subscription_plans as
      | { plan_key: string; display_name: string | null }
      | { plan_key: string; display_name: string | null }[]
      | null;
    const planRow = Array.isArray(plan) ? plan[0] : plan;

    const status = data.status as string;
    const isEntitled = ENTITLED_SUBSCRIPTION_STATUSES.includes(
      status as (typeof ENTITLED_SUBSCRIPTION_STATUSES)[number],
    );

    return {
      organization_id: organizationId,
      has_stripe_customer: hasStripeCustomer,
      subscription: {
        status,
        plan_key: planRow?.plan_key ?? 'unknown',
        plan_display_name: planRow?.display_name ?? null,
        seat_quantity: data.seat_quantity ?? 1,
        current_period_end: data.current_period_end,
        trial_end: data.trial_end ?? null,
        cancel_at_period_end: data.cancel_at_period_end ?? false,
      },
      is_entitled: isEntitled,
      can_manage_in_stripe: hasStripeCustomer,
      free_trial_available: freeTrialAvailable,
    };
  }

  private async getActiveStripeSubscriptionId(organizationId: string): Promise<string | null> {
    const { data, error } = await this.getDb()
      .from('organization_subscriptions')
      .select('stripe_subscription_id')
      .eq('organization_id', organizationId)
      .in('status', [...ACTIVE_LIKE_SUBSCRIPTION_STATUSES])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`organization_subscriptions portal lookup failed: ${error.message}`);
      throw new BadRequestException('Could not load subscription for billing portal');
    }

    return data?.stripe_subscription_id?.trim() ?? null;
  }

  private portalReturnUrlWithBillingFlag(flag: string): string {
    const base = this.getBillingPortalReturnUrl();
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}billing=${encodeURIComponent(flag)}`;
  }

  async createBillingPortalSession(
    organizationId: string,
    flow: BillingPortalFlow = 'home',
  ): Promise<{ url: string }> {
    const organization = await this.getOrganizationForBilling(organizationId);

    if (!organization.stripe_customer_id?.trim()) {
      throw new BadRequestException(
        'No Stripe customer for this organization. Complete subscription checkout first.',
      );
    }

    const stripe = this.getStripe();
    const returnUrl = this.getBillingPortalReturnUrl();
    const customer = organization.stripe_customer_id;

    const configuration =
      flow === 'invoice_history'
        ? await this.portalConfigService.resolveInvoiceHistoryConfigurationId()
        : await this.portalConfigService.resolveConfigurationId({
            forceSync: flow === 'subscription_update',
          });

    if (flow === 'subscription_update' && !configuration) {
      throw new BadRequestException(
        'Billing portal plan catalog is not configured. Ensure subscription_plans have real Stripe price ids, then ask a platform admin to run POST /billing/setup/sync-portal.',
      );
    }

    if (flow === 'invoice_history' && !configuration) {
      throw new BadRequestException(
        'Invoice history portal is not configured. Ask a platform admin to run POST /billing/setup/sync-portal.',
      );
    }

    const sessionBase = {
      customer,
      return_url: returnUrl,
      ...(configuration ? { configuration } : {}),
    };

    if (flow === 'home') {
      const portalSession = await stripe.billingPortal.sessions.create({
        ...sessionBase,
        return_url: this.portalReturnUrlWithBillingFlag('invoices'),
      });
      if (!portalSession.url) {
        throw new BadRequestException('Stripe did not return a billing portal URL');
      }
      return { url: portalSession.url };
    }

    if (flow === 'invoice_history') {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer,
        configuration: configuration!,
        return_url: this.portalReturnUrlWithBillingFlag('invoices'),
      });
      if (!portalSession.url) {
        throw new BadRequestException('Stripe did not return a billing portal URL');
      }
      return { url: portalSession.url };
    }

    if (flow === 'payment_method_update') {
      const portalSession = await stripe.billingPortal.sessions.create({
        ...sessionBase,
        flow_data: {
          type: 'payment_method_update',
          after_completion: {
            type: 'redirect',
            redirect: { return_url: this.portalReturnUrlWithBillingFlag('payment_updated') },
          },
        },
      });
      if (!portalSession.url) {
        throw new BadRequestException('Stripe did not return a billing portal URL');
      }
      return { url: portalSession.url };
    }

    const stripeSubscriptionId = await this.getActiveStripeSubscriptionId(organizationId);
    if (!stripeSubscriptionId) {
      throw new BadRequestException(
        'No active subscription for this organization. Subscribe via checkout first.',
      );
    }

    if (flow === 'subscription_cancel') {
      const portalSession = await stripe.billingPortal.sessions.create({
        ...sessionBase,
        flow_data: {
          type: 'subscription_cancel',
          subscription_cancel: { subscription: stripeSubscriptionId },
          after_completion: {
            type: 'redirect',
            redirect: { return_url: this.portalReturnUrlWithBillingFlag('canceled') },
          },
        },
      });
      if (!portalSession.url) {
        throw new BadRequestException('Stripe did not return a billing portal URL');
      }
      return { url: portalSession.url };
    }

    if (flow === 'subscription_update') {
      throw new BadRequestException(
        'Plan changes are managed in organization billing settings (in-app plan switch). Stripe Portal plan updates are disabled.',
      );
    }

    throw new BadRequestException(`Unsupported billing portal flow: ${flow}`);
  }
}
