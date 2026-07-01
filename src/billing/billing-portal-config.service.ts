import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { TEAM_PLAN_MAX_SEATS } from './dto/create-checkout-session.dto';
import { STRIPE_PLAN_PLACEHOLDER_MARKER } from './billing.constants';
import { SubscriptionPlanRow } from './billing.types';

const PORTAL_CONFIG_METADATA_KEY = 'conviction_portal_sync';
const PORTAL_CONFIG_METADATA_VALUE = 'v1';
const PORTAL_CONFIG_NAME = 'Conviction Billing Portal';

const INVOICE_HISTORY_CONFIG_METADATA_VALUE = 'v1_invoice_history';
const INVOICE_HISTORY_CONFIG_NAME = 'Conviction Billing Portal — Invoice History';

export interface PortalPlanProductCorrection {
  plan_key: string;
  stripe_price_id: string;
  db_stripe_product_id: string;
  stripe_actual_product_id: string;
  corrected_in_db: boolean;
}

export interface PortalConfigurationSyncResult {
  configuration_id: string;
  product_count: number;
  price_count: number;
  products: Array<{ product_id: string; price_ids: string[]; per_seat: boolean }>;
  /** Rows where subscription_plans.stripe_product_id did not match the Price's Product in Stripe. */
  product_id_corrections: PortalPlanProductCorrection[];
}

type StripeClient = InstanceType<typeof Stripe>;

/** Stripe v22 types live on the core namespace, not on the default constructor export. */
type PortalConfigurationCreateParams = Parameters<
  StripeClient['billingPortal']['configurations']['create']
>[0];
type PortalFeatures = PortalConfigurationCreateParams['features'];
type PortalSubscriptionProduct = {
  product: string;
  prices: string[];
  adjustable_quantity?: { enabled: boolean; minimum: number; maximum: number };
};

@Injectable()
export class BillingPortalConfigService {
  private readonly logger = new Logger(BillingPortalConfigService.name);
  private readonly adminClient: SupabaseClient | null;
  private cachedConfigurationId: string | null = null;
  private cachedInvoiceHistoryConfigurationId: string | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    this.adminClient =
      url && (serviceRoleKey || anonKey)
        ? createClient(url, serviceRoleKey ?? anonKey!)
        : null;
  }

  private getStripe(): StripeClient | null {
    const secretKey = this.config.get<string>('stripe.secretKey');
    return secretKey ? new Stripe(secretKey, { typescript: true }) : null;
  }

  private getDb(): SupabaseClient {
    if (!this.adminClient) {
      throw new Error('Database client is not configured');
    }
    return this.adminClient;
  }

  clearCache(): void {
    this.cachedConfigurationId = null;
    this.cachedInvoiceHistoryConfigurationId = null;
  }

  /** CON-154: portal configuration with only invoice history (no cancel / payment method). */
  async resolveInvoiceHistoryConfigurationId(): Promise<string | null> {
    const manual = this.config
      .get<string>('stripe.billingPortalInvoiceHistoryConfigurationId')
      ?.trim();
    if (manual) {
      return manual;
    }

    if (this.cachedInvoiceHistoryConfigurationId) {
      return this.cachedInvoiceHistoryConfigurationId;
    }

    const stripe = this.getStripe();
    if (!stripe) {
      return null;
    }

    try {
      const result = await this.syncInvoiceHistoryConfiguration(stripe);
      this.cachedInvoiceHistoryConfigurationId = result.configuration_id;
      return result.configuration_id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Invoice-history portal configuration sync failed: ${message}`);
      return null;
    }
  }

  /** Env override or synced configuration id (cached per process). */
  async resolveConfigurationId(options?: { forceSync?: boolean }): Promise<string | null> {
    const manual = this.config.get<string>('stripe.billingPortalConfigurationId')?.trim();
    if (manual) {
      return manual;
    }

    if (!options?.forceSync && this.cachedConfigurationId) {
      return this.cachedConfigurationId;
    }

    const stripe = this.getStripe();
    if (!stripe) {
      return null;
    }

    try {
      const result = await this.syncFromDatabasePlans(stripe);
      this.cachedConfigurationId = result.configuration_id;
      return result.configuration_id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Portal configuration sync failed: ${message}`);
      return null;
    }
  }

  async inspectConfiguration(): Promise<{
    configuration_id: string | null;
    subscription_update_enabled: boolean;
    portal_product_count: number;
    portal_price_count: number;
  }> {
    const stripe = this.getStripe();
    if (!stripe) {
      return {
        configuration_id: null,
        subscription_update_enabled: false,
        portal_product_count: 0,
        portal_price_count: 0,
      };
    }

    const configId = await this.resolveConfigurationId();
    if (!configId) {
      return {
        configuration_id: null,
        subscription_update_enabled: false,
        portal_product_count: 0,
        portal_price_count: 0,
      };
    }

    const config = await stripe.billingPortal.configurations.retrieve(configId);
    const subUpdate = config.features?.subscription_update;
    const products = subUpdate?.products ?? [];
    let priceCount = 0;
    for (const p of products) {
      priceCount += p.prices?.length ?? 0;
    }

    return {
      configuration_id: configId,
      subscription_update_enabled: subUpdate?.enabled ?? false,
      portal_product_count: products.length,
      portal_price_count: priceCount,
    };
  }

  /**
   * Build/update Stripe Customer Portal configuration from subscription_plans so
   * subscription_update shows Professional, Team, and Enterprise prices (not only current plan).
   */
  async syncFromDatabasePlans(stripe?: StripeClient): Promise<PortalConfigurationSyncResult> {
    const client = stripe ?? this.getStripe();
    if (!client) {
      throw new Error('Stripe is not configured');
    }

    const { data, error } = await this.getDb()
      .from('subscription_plans')
      .select(
        'plan_key, stripe_product_id, stripe_price_id, pricing_model, seat_based_enabled, is_active',
      )
      .eq('is_active', true);

    if (error) {
      throw new Error(`subscription_plans read failed: ${error.message}`);
    }

    const plans = (data ?? []) as Pick<
      SubscriptionPlanRow,
      'plan_key' | 'stripe_product_id' | 'stripe_price_id' | 'pricing_model' | 'seat_based_enabled' | 'is_active'
    >[];

    const sellable = plans.filter(
      (p) =>
        !p.stripe_price_id.includes(STRIPE_PLAN_PLACEHOLDER_MARKER) &&
        !p.stripe_product_id.includes(STRIPE_PLAN_PLACEHOLDER_MARKER),
    );

    if (sellable.length === 0) {
      throw new Error(
        'No sellable subscription_plans with real Stripe ids — update prod_/price_ ids in the database first.',
      );
    }

    const byProduct = new Map<string, { prices: Set<string>; perSeat: boolean }>();
    const productIdCorrections: PortalPlanProductCorrection[] = [];

    for (const plan of sellable) {
      const price = await client.prices.retrieve(plan.stripe_price_id);
      const stripeProductId =
        typeof price.product === 'string' ? price.product : price.product?.id;

      if (!stripeProductId) {
        throw new Error(
          `Stripe price ${plan.stripe_price_id} (${plan.plan_key}) has no product — archive or fix the price in Stripe Dashboard.`,
        );
      }

      if (plan.stripe_product_id !== stripeProductId) {
        productIdCorrections.push({
          plan_key: plan.plan_key,
          stripe_price_id: plan.stripe_price_id,
          db_stripe_product_id: plan.stripe_product_id,
          stripe_actual_product_id: stripeProductId,
          corrected_in_db: false,
        });

        const { error: fixError } = await this.getDb()
          .from('subscription_plans')
          .update({ stripe_product_id: stripeProductId })
          .eq('plan_key', plan.plan_key);

        if (fixError) {
          throw new Error(
            `Plan "${plan.plan_key}": price ${plan.stripe_price_id} belongs to Stripe product ${stripeProductId}, but DB has ${plan.stripe_product_id}. Auto-fix failed: ${fixError.message}`,
          );
        }

        productIdCorrections[productIdCorrections.length - 1].corrected_in_db = true;
        this.logger.warn(
          `Corrected subscription_plans.stripe_product_id for ${plan.plan_key}: ${plan.stripe_product_id} → ${stripeProductId}`,
        );
      }

      const entry = byProduct.get(stripeProductId) ?? {
        prices: new Set<string>(),
        perSeat: false,
      };
      entry.prices.add(plan.stripe_price_id);
      if (plan.pricing_model === 'per_seat' || plan.seat_based_enabled) {
        entry.perSeat = true;
      }
      byProduct.set(stripeProductId, entry);
    }

    if (byProduct.size > 10) {
      throw new Error(
        `Stripe portal supports at most 10 products for plan switching; found ${byProduct.size}.`,
      );
    }

    const portalProducts: PortalSubscriptionProduct[] = [];

    const productSummaries: PortalConfigurationSyncResult['products'] = [];

    for (const [productId, entry] of byProduct.entries()) {
      const prices = [...entry.prices];
      productSummaries.push({
        product_id: productId,
        price_ids: prices,
        per_seat: entry.perSeat,
      });

      const productConfig: PortalSubscriptionProduct = {
        product: productId,
        prices,
      };

      if (entry.perSeat) {
        productConfig.adjustable_quantity = {
          enabled: true,
          minimum: 1,
          maximum: TEAM_PLAN_MAX_SEATS,
        };
      }

      portalProducts.push(productConfig);
    }

    const returnUrl = this.config.get<string>('stripe.billingPortalReturnUrl')?.trim() ?? undefined;

    const features: PortalFeatures = {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        proration_behavior: 'none',
      },
      // Plan switches use POST /billing/change-plan (upgrade/downgrade/interval proration rules).
      subscription_update: {
        enabled: false,
      },
    };

    const existing = await this.findExistingConfiguration(client, {
      metadataValue: PORTAL_CONFIG_METADATA_VALUE,
      configName: PORTAL_CONFIG_NAME,
    });
    let configurationId: string;

    if (existing) {
      const updated = await client.billingPortal.configurations.update(existing.id, {
        default_return_url: returnUrl || undefined,
        features,
        metadata: {
          [PORTAL_CONFIG_METADATA_KEY]: PORTAL_CONFIG_METADATA_VALUE,
        },
      });
      configurationId = updated.id;
      this.logger.log(
        `Updated Stripe portal configuration ${configurationId} with ${portalProducts.length} products`,
      );
    } else {
      const created = await client.billingPortal.configurations.create({
        name: PORTAL_CONFIG_NAME,
        default_return_url: returnUrl || undefined,
        features,
        metadata: {
          [PORTAL_CONFIG_METADATA_KEY]: PORTAL_CONFIG_METADATA_VALUE,
        },
      });
      configurationId = created.id;
      this.logger.log(
        `Created Stripe portal configuration ${configurationId} with ${portalProducts.length} products`,
      );
    }

    this.cachedConfigurationId = configurationId;

    const priceCount = productSummaries.reduce((n, p) => n + p.price_ids.length, 0);

    return {
      configuration_id: configurationId,
      product_count: portalProducts.length,
      price_count: priceCount,
      products: productSummaries,
      product_id_corrections: productIdCorrections,
    };
  }

  /**
   * Stripe portal config used for CON-154 "View payment history" — invoices only.
   * Does not require subscription_plans (no product catalog).
   */
  async syncInvoiceHistoryConfiguration(
    stripe?: StripeClient,
  ): Promise<{ configuration_id: string }> {
    const client = stripe ?? this.getStripe();
    if (!client) {
      throw new Error('Stripe is not configured');
    }

    const returnUrl = this.config.get<string>('stripe.billingPortalReturnUrl')?.trim() ?? undefined;

    const features: PortalFeatures = {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: false },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
      customer_update: { enabled: false },
    };

    const existing = await this.findExistingConfiguration(client, {
      metadataValue: INVOICE_HISTORY_CONFIG_METADATA_VALUE,
      configName: INVOICE_HISTORY_CONFIG_NAME,
    });

    let configurationId: string;

    if (existing) {
      const updated = await client.billingPortal.configurations.update(existing.id, {
        default_return_url: returnUrl || undefined,
        features,
        metadata: {
          [PORTAL_CONFIG_METADATA_KEY]: INVOICE_HISTORY_CONFIG_METADATA_VALUE,
        },
      });
      configurationId = updated.id;
      this.logger.log(`Updated Stripe invoice-history portal configuration ${configurationId}`);
    } else {
      const created = await client.billingPortal.configurations.create({
        name: INVOICE_HISTORY_CONFIG_NAME,
        default_return_url: returnUrl || undefined,
        features,
        metadata: {
          [PORTAL_CONFIG_METADATA_KEY]: INVOICE_HISTORY_CONFIG_METADATA_VALUE,
        },
      });
      configurationId = created.id;
      this.logger.log(`Created Stripe invoice-history portal configuration ${configurationId}`);
    }

    this.cachedInvoiceHistoryConfigurationId = configurationId;
    return { configuration_id: configurationId };
  }

  private async findExistingConfiguration(
    stripe: StripeClient,
    match: { metadataValue: string; configName: string },
  ): Promise<{ id: string } | null> {
    let startingAfter: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const list = await stripe.billingPortal.configurations.list({
        limit: 100,
        starting_after: startingAfter,
      });

      for (const row of list.data) {
        if (
          row.metadata?.[PORTAL_CONFIG_METADATA_KEY] === match.metadataValue ||
          row.name === match.configName
        ) {
          return row;
        }
      }

      if (!list.has_more || list.data.length === 0) {
        break;
      }
      startingAfter = list.data[list.data.length - 1]?.id;
    }

    return null;
  }
}
