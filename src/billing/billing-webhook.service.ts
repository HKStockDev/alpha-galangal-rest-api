import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  computeBillingPeriodRemainingFraction,
  isPlanCreditDowngrade,
  shouldRetainPriorPlanRecord,
} from '../credits/credit-subscription-sync';
import { CreditsService } from '../credits/credits.service';
import { BillingEmailService } from './billing-email.service';
import {
  BillingSubscriptionSnapshot,
  detectBillingNotificationTransitions,
} from './billing-email-transitions';
import { BillingService } from './billing.service';
import { SubscriptionPlanRow } from './billing.types';

type StripeApi = ReturnType<BillingService['getStripe']>;
type StripeEvent = Awaited<ReturnType<StripeApi['webhooks']['constructEvent']>>;
type StripeSubscription = Awaited<ReturnType<StripeApi['subscriptions']['retrieve']>>;
type StripeCheckoutSession = Awaited<ReturnType<StripeApi['checkout']['sessions']['retrieve']>>;
type StripeInvoice = {
  subscription?: string | { id: string } | null;
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string } | null;
    };
  };
};

const ACTIVE_LIKE_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'incomplete',
  'unpaid',
  'paused',
] as const;

type OrgSubscriptionStatus = (typeof ACTIVE_LIKE_STATUSES)[number] | 'canceled' | 'incomplete_expired';

const HANDLED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
]);

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);
  private readonly adminClient: SupabaseClient | null;

  constructor(
    private readonly billingService: BillingService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => CreditsService))
    private readonly creditsService: CreditsService,
    private readonly billingEmailService: BillingEmailService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    this.adminClient =
      url && (serviceRoleKey || anonKey)
        ? createClient(url, serviceRoleKey ?? anonKey!)
        : null;
  }

  private getDb(): SupabaseClient {
    if (!this.adminClient) {
      throw new InternalServerErrorException('Database client is not configured');
    }
    return this.adminClient;
  }

  private getStripe() {
    return this.billingService.getStripe();
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ received: boolean }> {
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }

    const stripe = this.getStripe();
    const webhookSecret = this.billingService.requireWebhookSecret();

    let event: StripeEvent;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid signature';
      throw new BadRequestException(`Stripe webhook signature verification failed: ${message}`);
    }

    const isDuplicate = await this.tryRecordEvent(event);
    if (isDuplicate) {
      return { received: true };
    }

    try {
      if (HANDLED_EVENT_TYPES.has(event.type)) {
        await this.dispatchEvent(event);
      }
      await this.markEventProcessed(event.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Webhook ${event.id} (${event.type}) failed: ${message}`);
      await this.markEventFailed(event.id, message);
      throw new InternalServerErrorException('Webhook processing failed');
    }

    return { received: true };
  }

  /** Re-run dispatch for a row in stripe_event_log (platform admin retry). */
  async reprocessLoggedEvent(logId: string): Promise<void> {
    const { data, error } = await this.getDb()
      .from('stripe_event_log')
      .select('id, stripe_event_id, event_type, status, payload')
      .eq('id', logId)
      .maybeSingle();

    if (error) {
      this.logger.error(`stripe_event_log lookup failed: ${error.message}`);
      throw new InternalServerErrorException('Could not load Stripe event');
    }
    if (!data) {
      throw new BadRequestException('Stripe event log entry not found');
    }

    if (data.status === 'processed') {
      throw new BadRequestException('This event was already processed successfully');
    }

    const event = data.payload as StripeEvent;
    if (!event?.id || !event?.type) {
      throw new BadRequestException('Stored event payload is invalid');
    }

    await this.getDb()
      .from('stripe_event_log')
      .update({
        status: 'pending',
        processed_at: null,
        error_message: null,
      })
      .eq('id', logId);

    try {
      if (HANDLED_EVENT_TYPES.has(event.type)) {
        await this.dispatchEvent(event);
      }
      await this.markEventProcessed(event.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Webhook retry ${event.id} (${event.type}) failed: ${message}`);
      await this.markEventFailed(event.id, message);
      throw new BadRequestException(`Retry failed: ${message}`);
    }
  }

  private async tryRecordEvent(event: StripeEvent): Promise<boolean> {
    const { error } = await this.getDb().from('stripe_event_log').insert({
      stripe_event_id: event.id,
      event_type: event.type,
      status: 'pending',
      payload: event as unknown as Record<string, unknown>,
    });

    if (!error) {
      return false;
    }

    if (error.code === '23505') {
      return true;
    }

    this.logger.error(`stripe_event_log insert failed: ${error.message}`);
    throw new InternalServerErrorException('Could not record Stripe event');
  }

  private async markEventProcessed(stripeEventId: string): Promise<void> {
    await this.getDb()
      .from('stripe_event_log')
      .update({
        status: 'processed',
        processed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('stripe_event_id', stripeEventId);
  }

  private async markEventFailed(stripeEventId: string, errorMessage: string): Promise<void> {
    await this.getDb()
      .from('stripe_event_log')
      .update({
        status: 'failed',
        processed_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq('stripe_event_id', stripeEventId);
  }

  private async dispatchEvent(event: StripeEvent): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutSessionCompleted(
          event.data.object as StripeCheckoutSession,
          event.id,
        );
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.syncSubscription(event.data.object as StripeSubscription, {
          stripeEventId: event.id,
        });
        break;
      case 'invoice.payment_failed': {
        const invoice = event.data.object as StripeInvoice;
        const subscriptionId = this.extractSubscriptionIdFromInvoice(invoice);
        if (subscriptionId) {
          const stripe = this.getStripe();
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await this.syncSubscription(subscription, { stripeEventId: event.id });
        }
        break;
      }
      default:
        break;
    }
  }

  private async onCheckoutSessionCompleted(
    session: StripeCheckoutSession,
    stripeEventId: string,
  ): Promise<void> {
    if (session.mode === 'payment') {
      if (session.metadata?.checkout_flow === 'credit_pack') {
        const organizationId = session.metadata.organization_id;
        const creditPackId = session.metadata.credit_pack_id;
        if (!organizationId || !creditPackId) {
          throw new Error(
            `checkout.session.completed ${session.id} missing credit pack metadata`,
          );
        }
        await this.creditsService.fulfillPackPurchase({
          organizationId,
          creditPackId,
          stripeCheckoutSessionId: session.id,
          stripeInvoiceId:
            typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null,
        });
      }
      return;
    }

    if (session.mode !== 'subscription') {
      return;
    }

    const subscriptionRef = session.subscription;
    if (!subscriptionRef) {
      this.logger.warn(`checkout.session.completed ${session.id} has no subscription`);
      return;
    }

    const stripe = this.getStripe();
    const subscriptionId =
      typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef.id;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    const organizationId =
      session.metadata?.organization_id ??
      subscription.metadata?.organization_id ??
      (await this.resolveOrganizationIdFromCustomer(
        typeof session.customer === 'string' ? session.customer : session.customer?.id,
      ));

    if (organizationId && !subscription.metadata?.organization_id) {
      await stripe.subscriptions.update(subscription.id, {
        metadata: {
          ...subscription.metadata,
          organization_id: organizationId,
          plan_key: session.metadata?.plan_key ?? subscription.metadata?.plan_key ?? '',
          plan_id: session.metadata?.plan_id ?? subscription.metadata?.plan_id ?? '',
        },
      });
      subscription.metadata = {
        ...subscription.metadata,
        organization_id: organizationId,
      };
    }

    await this.syncSubscription(subscription, { stripeEventId });

    if (session.metadata?.checkout_flow === 'trial' && organizationId) {
      await this.billingService.markOrganizationTrialUsed(organizationId);
    }
  }

  private extractSubscriptionIdFromInvoice(invoice: StripeInvoice): string | null {
    const legacy = invoice.subscription;
    if (legacy) {
      return typeof legacy === 'string' ? legacy : legacy.id;
    }
    const nested = invoice.parent?.subscription_details?.subscription;
    if (!nested) {
      return null;
    }
    return typeof nested === 'string' ? nested : nested.id;
  }

  private async syncSubscription(
    subscription: StripeSubscription,
    options?: { stripeEventId?: string },
  ): Promise<void> {
    const stripe = this.getStripe();
    let full: StripeSubscription =
      subscription.items?.data?.length > 0
        ? subscription
        : await stripe.subscriptions.retrieve(subscription.id, { expand: ['items.data.price'] });

    const organizationId = await this.resolveOrganizationIdForSubscription(full);
    if (!organizationId) {
      throw new Error(`Could not resolve organization for subscription ${full.id}`);
    }

    const { data: existingBySub } = await this.getDb()
      .from('organization_subscriptions')
      .select('id, current_period_start, plan_id, status, cancel_at_period_end, trial_end')
      .eq('stripe_subscription_id', full.id)
      .maybeSingle();

    const previousSnapshot: BillingSubscriptionSnapshot | null = existingBySub
      ? {
          status: (existingBySub.status as string) ?? 'incomplete',
          planId: (existingBySub.plan_id as string | null) ?? null,
          cancelAtPeriodEnd: Boolean(existingBySub.cancel_at_period_end),
        }
      : null;

    const periodStartEarly = full.items.data[0]?.current_period_start ?? null;
    const periodStartIsoEarly = this.unixToIso(periodStartEarly);
    const isNewPeriodEarly =
      !existingBySub?.current_period_start ||
      existingBySub.current_period_start !== periodStartIsoEarly;

    if (isNewPeriodEarly && full.metadata?.pending_plan_id?.trim()) {
      full = (await this.billingService.applyDeferredSubscriptionPlanChange(
        full,
      )) as StripeSubscription;
    }

    const primaryItem = full.items.data[0];
    if (!primaryItem) {
      throw new Error(`Subscription ${full.id} has no line items`);
    }

    const priceId =
      typeof primaryItem.price === 'string' ? primaryItem.price : primaryItem.price?.id;
    if (!priceId) {
      throw new Error(`Subscription ${full.id} has no price on primary item`);
    }

    const plan = await this.findPlanByStripePriceId(priceId);
    if (!plan) {
      throw new Error(`No subscription_plans row for Stripe price ${priceId}`);
    }

    const policy = await this.creditsService.getPolicyConfig();

    const customerId =
      typeof full.customer === 'string' ? full.customer : full.customer?.id ?? '';
    if (!customerId) {
      throw new Error(`Subscription ${full.id} has no customer`);
    }

    await this.billingService.setOrganizationStripeCustomerId(organizationId, customerId);

    const status = this.mapSubscriptionStatus(full.status);
    const seatQuantity = Math.max(1, primaryItem.quantity ?? 1);
    const pricePerSeatCents =
      plan.pricing_model === 'per_seat' ? plan.unit_amount_cents : null;

    const periodStart = primaryItem.current_period_start ?? null;
    const periodEnd = primaryItem.current_period_end ?? null;
    const periodStartIso = this.unixToIso(periodStart);
    const isNewPeriod =
      !existingBySub?.current_period_start ||
      existingBySub.current_period_start !== periodStartIso;

    let previousPlanMonthlyBase: number | null = null;
    let previousPlanRow: SubscriptionPlanRow | null = null;
    if (existingBySub?.plan_id) {
      previousPlanRow = await this.loadPlanById(existingBySub.plan_id as string);
      previousPlanMonthlyBase = previousPlanRow?.monthly_base_credits ?? null;
    }

    const planChanged = Boolean(
      existingBySub?.plan_id && existingBySub.plan_id !== plan.id,
    );
    const stripePlanMonthlyBase = plan.monthly_base_credits ?? 0;
    const isCreditDowngrade = isPlanCreditDowngrade(
      previousPlanMonthlyBase,
      stripePlanMonthlyBase,
    );
    const retainPriorPlanRecord = shouldRetainPriorPlanRecord({
      planChanged,
      isNewPeriod,
      isDowngrade: isCreditDowngrade,
      downgradeEffectiveMode: policy.downgrade_effective_mode,
    });
    const rowPlanId =
      retainPriorPlanRecord && existingBySub?.plan_id
        ? existingBySub.plan_id
        : plan.id;
    const prorateRemainingFraction =
      computeBillingPeriodRemainingFraction(periodStart, periodEnd) ?? undefined;

    const row = {
      organization_id: organizationId,
      plan_id: rowPlanId,
      stripe_customer_id: customerId,
      stripe_subscription_id: full.id,
      status,
      current_period_start: periodStartIso,
      current_period_end: this.unixToIso(periodEnd),
      cancel_at_period_end: full.cancel_at_period_end ?? false,
      cancel_at: this.unixToIso(full.cancel_at),
      canceled_at: this.unixToIso(full.canceled_at),
      trial_end: this.unixToIso(full.trial_end),
      seat_quantity: seatQuantity,
      price_per_seat_cents: pricePerSeatCents,
      last_stripe_event_at: new Date().toISOString(),
      stripe_payload: full as unknown as Record<string, unknown>,
    };

    if (existingBySub?.id) {
      const { error } = await this.getDb()
        .from('organization_subscriptions')
        .update(row)
        .eq('id', existingBySub.id);
      if (error) {
        throw new Error(error.message);
      }

      if (ACTIVE_LIKE_STATUSES.includes(status as (typeof ACTIVE_LIKE_STATUSES)[number])) {
        await this.creditsService.syncBaseCreditsFromSubscription({
          organizationId,
          planId: plan.id,
          periodStart: periodStartIso,
          periodEnd: this.unixToIso(periodEnd),
          isNewPeriod,
          prorateRemainingFraction,
          previousPlanMonthlyBase,
          planChanged,
        });
      }

      await this.maybeSendBillingNotifications({
        stripeEventId: options?.stripeEventId,
        organizationId,
        isNewSubscription: false,
        previousSnapshot,
        status,
        plan,
        previousPlanRow,
        periodEnd: this.unixToIso(periodEnd),
        seatQuantity,
        cancelAtPeriodEnd: full.cancel_at_period_end ?? false,
      });
      return;
    }

    if (ACTIVE_LIKE_STATUSES.includes(status as (typeof ACTIVE_LIKE_STATUSES)[number])) {
      const { data: activeOnOrg } = await this.getDb()
        .from('organization_subscriptions')
        .select('id, stripe_subscription_id')
        .eq('organization_id', organizationId)
        .in('status', [...ACTIVE_LIKE_STATUSES])
        .maybeSingle();

      if (activeOnOrg?.id && activeOnOrg.stripe_subscription_id !== full.id) {
        const { error: cancelError } = await this.getDb()
          .from('organization_subscriptions')
          .update({
            status: 'canceled',
            canceled_at: new Date().toISOString(),
            last_stripe_event_at: new Date().toISOString(),
          })
          .eq('id', activeOnOrg.id);
        if (cancelError) {
          throw new Error(cancelError.message);
        }
      }
    }

    const { error: insertError } = await this.getDb().from('organization_subscriptions').insert(row);
    if (insertError) {
      throw new Error(insertError.message);
    }

    if (ACTIVE_LIKE_STATUSES.includes(status as (typeof ACTIVE_LIKE_STATUSES)[number])) {
      await this.creditsService.syncBaseCreditsFromSubscription({
        organizationId,
        planId: plan.id,
        periodStart: periodStartIso,
        periodEnd: this.unixToIso(periodEnd),
        isNewPeriod: true,
        prorateRemainingFraction,
        previousPlanMonthlyBase: null,
        planChanged: false,
      });
    }

    await this.maybeSendBillingNotifications({
      stripeEventId: options?.stripeEventId,
      organizationId,
      isNewSubscription: true,
      previousSnapshot,
      status,
      plan,
      previousPlanRow: null,
      periodEnd: this.unixToIso(periodEnd),
      seatQuantity,
      cancelAtPeriodEnd: full.cancel_at_period_end ?? false,
    });
  }

  private async maybeSendBillingNotifications(params: {
    stripeEventId?: string;
    organizationId: string;
    isNewSubscription: boolean;
    previousSnapshot: BillingSubscriptionSnapshot | null;
    status: OrgSubscriptionStatus;
    plan: SubscriptionPlanRow;
    previousPlanRow: SubscriptionPlanRow | null;
    periodEnd: string | null;
    seatQuantity: number;
    cancelAtPeriodEnd: boolean;
  }): Promise<void> {
    if (!params.stripeEventId) {
      return;
    }

    const nextSnapshot: BillingSubscriptionSnapshot = {
      status: params.status,
      planId: params.plan.id,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    };

    const transitions = detectBillingNotificationTransitions({
      isNewSubscription: params.isNewSubscription,
      previous: params.previousSnapshot,
      next: nextSnapshot,
      previousPlan: params.previousPlanRow,
      nextPlan: params.plan,
      seatQuantity: params.seatQuantity,
    });

    for (const transition of transitions) {
      await this.billingEmailService.sendBillingNotification({
        organizationId: params.organizationId,
        stripeEventId: params.stripeEventId,
        transition,
        plan: params.plan,
        previousPlan: params.previousPlanRow,
        periodEnd: params.periodEnd,
        seatQuantity: params.seatQuantity,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd,
      });
    }
  }

  private async loadPlanById(planId: string): Promise<SubscriptionPlanRow | null> {
    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select(
        'id, plan_key, stripe_product_id, stripe_price_id, display_name, billing_interval, currency, amount_cents, pricing_model, seat_based_enabled, unit_amount_cents, monthly_base_credits, is_active',
      )
      .eq('id', planId)
      .maybeSingle();

    if (error) {
      this.logger.error(`subscription_plans lookup by id failed: ${error.message}`);
      return null;
    }

    return (data as SubscriptionPlanRow | null) ?? null;
  }

  private async resolveOrganizationIdForSubscription(
    subscription: StripeSubscription,
  ): Promise<string | null> {
    if (subscription.metadata?.organization_id) {
      return subscription.metadata.organization_id;
    }

    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

    return this.resolveOrganizationIdFromCustomer(customerId);
  }

  private async resolveOrganizationIdFromCustomer(
    customerId: string | null | undefined,
  ): Promise<string | null> {
    if (!customerId) {
      return null;
    }

    const { data: orgRow } = await this.getDb()
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (orgRow?.id) {
      return orgRow.id;
    }

    const stripe = this.getStripe();
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return null;
    }

    return customer.metadata?.organization_id ?? null;
  }

  private async findPlanByStripePriceId(priceId: string): Promise<SubscriptionPlanRow | null> {
    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select(
        'id, plan_key, stripe_product_id, stripe_price_id, display_name, billing_interval, currency, amount_cents, pricing_model, seat_based_enabled, unit_amount_cents, monthly_base_credits, is_active',
      )
      .eq('stripe_price_id', priceId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      this.logger.error(`subscription_plans lookup by price failed: ${error.message}`);
      return null;
    }

    return (data as SubscriptionPlanRow | null) ?? null;
  }

  private mapSubscriptionStatus(stripeStatus: StripeSubscription['status']): OrgSubscriptionStatus {
    const allowed: OrgSubscriptionStatus[] = [
      'trialing',
      'active',
      'past_due',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'unpaid',
      'paused',
    ];
    if (allowed.includes(stripeStatus as OrgSubscriptionStatus)) {
      return stripeStatus as OrgSubscriptionStatus;
    }
    this.logger.warn(`Unknown Stripe subscription status: ${stripeStatus}; mapping to incomplete`);
    return 'incomplete';
  }

  private unixToIso(unixSeconds: number | null | undefined): string | null {
    if (unixSeconds == null) {
      return null;
    }
    return new Date(unixSeconds * 1000).toISOString();
  }
}
