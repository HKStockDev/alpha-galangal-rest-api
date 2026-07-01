import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { BillingService } from '../billing/billing.service';
import { STRIPE_PLAN_PLACEHOLDER_MARKER } from '../billing/billing.constants';
import {
  ListAdminCreditTransactionsQueryDto,
  ListAdminCreditWalletsQueryDto,
  UpdateCapabilityCreditCostDto,
  UpdateCreditPolicyDto,
} from './dto/admin-credits.dto';
import { ListCreditTransactionsQueryDto } from './dto/list-credit-transactions-query.dto';
import { CreditCostDisabledException, InsufficientCreditsException } from './credits.errors';
import {
  isPlanCreditDowngrade,
  isPlanCreditUpgrade,
  resolveImmediateDowngradeRemaining,
  resolveNewPeriodBaseRemaining,
  resolveUpgradeMidCycleGrant,
  shouldDeferDowngradeCreditSync,
  shouldDeferUpgradeCreditSync,
} from './credit-subscription-sync';
import type {
  CapabilityCreditCostAdminRow,
  CreditPackCatalogItem,
  CreditPackRow,
  CreditPolicyConfigRow,
  CreditTransactionRow,
  CreditWalletRow,
  OrganizationCreditWalletResponse,
  SyncCreditPacksFromStripeResult,
} from './credits.types';

type ConsumeRpcResult = {
  skipped?: boolean;
  reason?: string;
  error?: string;
  required_credits?: number;
  remaining_credits?: number;
  consumed?: number;
};

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);
  private readonly adminClient: SupabaseClient | null;

  constructor(
    private readonly config: ConfigService,
    private readonly billingService: BillingService,
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
      throw new ServiceUnavailableException('Database client is not configured');
    }
    return this.adminClient;
  }

  toWalletResponse(row: CreditWalletRow): OrganizationCreditWalletResponse {
    return {
      organization_id: row.organization_id,
      base_credits_in_cycle: row.base_credits_in_cycle,
      base_credits_remaining: row.base_credits_remaining,
      pack_credits_remaining: row.pack_credits_remaining,
      total_credits_remaining: row.base_credits_remaining + row.pack_credits_remaining,
      cycle_start: row.cycle_start,
      cycle_end: row.cycle_end,
      last_reset_at: row.last_reset_at,
      last_consumed_at: row.last_consumed_at,
    };
  }

  async ensureWallet(organizationId: string, cycle?: { start: string | null; end: string | null }) {
    const { data: existing } = await this.getDb()
      .from('organization_credit_wallets')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (existing) {
      if (cycle?.start || cycle?.end) {
        const patch: Record<string, unknown> = {};
        if (cycle.start) patch.cycle_start = cycle.start;
        if (cycle.end) patch.cycle_end = cycle.end;
        if (Object.keys(patch).length > 0) {
          await this.getDb()
            .from('organization_credit_wallets')
            .update(patch)
            .eq('organization_id', organizationId);
        }
      }
      return existing as CreditWalletRow;
    }

    const insertRow = {
      organization_id: organizationId,
      base_credits_in_cycle: 0,
      base_credits_remaining: 0,
      pack_credits_remaining: 0,
      cycle_start: cycle?.start ?? null,
      cycle_end: cycle?.end ?? null,
    };

    const { data, error } = await this.getDb()
      .from('organization_credit_wallets')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      this.logger.error(`ensureWallet insert failed: ${error.message}`);
      throw new InternalServerErrorException('Could not initialize credit wallet');
    }

    return data as CreditWalletRow;
  }

  async getWallet(organizationId: string): Promise<OrganizationCreditWalletResponse> {
    const wallet = await this.ensureWallet(organizationId);
    return this.toWalletResponse(wallet);
  }

  async listTransactions(
    organizationId: string,
    query: ListCreditTransactionsQueryDto,
  ): Promise<CreditTransactionRow[]> {
    let q = this.getDb()
      .from('organization_credit_transactions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('occurred_at', { ascending: false })
      .range(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50) - 1);

    if (query.tx_type) {
      q = q.eq('tx_type', query.tx_type);
    }
    if (query.bucket_type) {
      q = q.eq('bucket_type', query.bucket_type);
    }

    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data ?? []) as CreditTransactionRow[];
  }

  async consume(params: {
    organizationId: string;
    capabilityKey: string;
    referenceId?: string;
  }): Promise<{ consumed: number; remainingCredits: number } | { skipped: true }> {
    const { data, error } = await this.getDb().rpc('consume_org_credits', {
      p_organization_id: params.organizationId,
      p_capability_key: params.capabilityKey,
      p_reference_id: params.referenceId ?? null,
    });

    if (error) {
      this.logger.error(`consume_org_credits RPC failed: ${error.message}`);
      throw new InternalServerErrorException('Credit consumption failed');
    }

    const result = data as ConsumeRpcResult;

    if (result.skipped) {
      return { skipped: true };
    }

    if (result.error === 'insufficient_credits') {
      throw new InsufficientCreditsException({
        capabilityKey: params.capabilityKey,
        requiredCredits: result.required_credits ?? 0,
        remainingCredits: result.remaining_credits ?? 0,
      });
    }

    if (result.error) {
      throw new InternalServerErrorException(`Credit consumption error: ${result.error}`);
    }

    return {
      consumed: result.consumed ?? 0,
      remainingCredits: result.remaining_credits ?? 0,
    };
  }

  async syncBaseCreditsFromSubscription(params: {
    organizationId: string;
    planId: string;
    periodStart: string | null;
    periodEnd: string | null;
    isNewPeriod: boolean;
    prorateRemainingFraction?: number;
    previousPlanMonthlyBase?: number | null;
    planChanged?: boolean;
  }): Promise<void> {
    const { data: plan, error: planError } = await this.getDb()
      .from('subscription_plans')
      .select('id, monthly_base_credits')
      .eq('id', params.planId)
      .maybeSingle();

    if (planError || !plan) {
      this.logger.warn(`syncBaseCredits: plan ${params.planId} not found`);
      return;
    }

    const monthlyBase = (plan.monthly_base_credits as number) ?? 0;
    const wallet = await this.ensureWallet(params.organizationId, {
      start: params.periodStart,
      end: params.periodEnd,
    });

    const policy = await this.getPolicyConfig();
    const planChanged = params.planChanged === true;
    const previousMonthlyBase = params.previousPlanMonthlyBase ?? null;
    const isUpgrade = planChanged && isPlanCreditUpgrade(previousMonthlyBase, monthlyBase);
    const isDowngrade = planChanged && isPlanCreditDowngrade(previousMonthlyBase, monthlyBase);

    if (
      shouldDeferDowngradeCreditSync({
        planChanged,
        isNewPeriod: params.isNewPeriod,
        isDowngrade,
        downgradeEffectiveMode: policy.downgrade_effective_mode,
      })
    ) {
      this.logger.log(
        `syncBaseCredits: deferring downgrade credit sync until next cycle (org=${params.organizationId})`,
      );
      return;
    }

    if (
      shouldDeferUpgradeCreditSync({
        planChanged,
        isNewPeriod: params.isNewPeriod,
        isUpgrade,
        upgradeProrationMode: policy.upgrade_proration_mode,
      })
    ) {
      this.logger.log(
        `syncBaseCredits: deferring upgrade credit sync until next cycle (org=${params.organizationId})`,
      );
      return;
    }

    if (!params.isNewPeriod && !planChanged && wallet.base_credits_in_cycle === monthlyBase) {
      return;
    }

    const now = new Date().toISOString();
    let newRemaining = monthlyBase;
    let ledgerGrants: { credits: number; note: string }[] = [];

    if (params.isNewPeriod) {
      await this.resetPackCreditsOnCycleRenewal(params.organizationId, wallet);

      if (!policy.base_carryover_enabled) {
        if (wallet.base_credits_remaining > 0) {
          await this.getDb().from('organization_credit_transactions').insert({
            organization_id: params.organizationId,
            wallet_id: wallet.id,
            tx_type: 'base_reset',
            bucket_type: 'base',
            credits_delta: -wallet.base_credits_remaining,
            note: 'Cycle reset — base credits do not carry over',
          });
        }
        newRemaining = monthlyBase;
        if (monthlyBase > 0) {
          ledgerGrants.push({ credits: monthlyBase, note: 'Billing cycle base grant' });
        }
      } else {
        const renewal = resolveNewPeriodBaseRemaining(
          monthlyBase,
          wallet.base_credits_remaining,
          policy,
        );
        if (renewal.forfeited > 0) {
          await this.getDb().from('organization_credit_transactions').insert({
            organization_id: params.organizationId,
            wallet_id: wallet.id,
            tx_type: 'base_reset',
            bucket_type: 'base',
            credits_delta: -renewal.forfeited,
            note: 'Cycle reset — base carryover cap exceeded',
          });
        }
        newRemaining = renewal.totalRemaining;
        if (monthlyBase > 0) {
          ledgerGrants.push({ credits: monthlyBase, note: 'Billing cycle base grant' });
        }
        if (renewal.carried > 0) {
          ledgerGrants.push({
            credits: renewal.carried,
            note: 'Base credits carried over from previous cycle',
          });
        }
      }
    } else if (planChanged && isUpgrade) {
      const { grant, skipSync } = resolveUpgradeMidCycleGrant(
        monthlyBase,
        params.prorateRemainingFraction,
        policy.upgrade_proration_mode,
      );
      if (skipSync) {
        return;
      }
      newRemaining = grant;
      if (grant > 0) {
        ledgerGrants.push({
          credits: grant,
          note:
            policy.upgrade_proration_mode === 'immediate_prorated'
              ? 'Prorated base grant (plan upgrade)'
              : 'Base grant (plan upgrade)',
        });
      }
    } else if (planChanged && isDowngrade) {
      newRemaining = resolveImmediateDowngradeRemaining(
        wallet.base_credits_remaining,
        monthlyBase,
      );
      const delta = newRemaining - wallet.base_credits_remaining;
      if (delta < 0) {
        await this.getDb().from('organization_credit_transactions').insert({
          organization_id: params.organizationId,
          wallet_id: wallet.id,
          tx_type: 'base_reset',
          bucket_type: 'base',
          credits_delta: delta,
          note: 'Base credits adjusted for plan downgrade',
        });
      }
    } else if (!planChanged) {
      newRemaining = monthlyBase;
      if (monthlyBase > 0) {
        ledgerGrants.push({ credits: monthlyBase, note: 'Billing cycle base grant' });
      }
    }

    const { error: walletError } = await this.getDb()
      .from('organization_credit_wallets')
      .update({
        base_credits_in_cycle: monthlyBase,
        base_credits_remaining: newRemaining,
        cycle_start: params.periodStart,
        cycle_end: params.periodEnd,
        last_reset_at: now,
      })
      .eq('organization_id', params.organizationId);

    if (walletError) {
      throw new Error(walletError.message);
    }

    if (ledgerGrants.length > 0) {
      const refreshed = await this.getDb()
        .from('organization_credit_wallets')
        .select('id')
        .eq('organization_id', params.organizationId)
        .single();

      for (const entry of ledgerGrants) {
        await this.getDb().from('organization_credit_transactions').insert({
          organization_id: params.organizationId,
          wallet_id: refreshed.data?.id,
          tx_type: 'base_grant',
          bucket_type: 'base',
          credits_delta: entry.credits,
          note: entry.note,
        });
      }
    }
  }

  /** Forfeit remaining pack lot balances on billing renewal when policy disables pack carryover. */
  async resetPackCreditsOnCycleRenewal(
    organizationId: string,
    wallet: CreditWalletRow,
  ): Promise<void> {
    const policy = await this.getPolicyConfig();
    if (policy.pack_carryover_until_expiry) {
      return;
    }

    const { data: lots, error: lotsError } = await this.getDb()
      .from('organization_credit_lots')
      .select('id, remaining_credits')
      .eq('organization_id', organizationId)
      .gt('remaining_credits', 0);

    if (lotsError) {
      throw new Error(lotsError.message);
    }

    if (!lots?.length) {
      return;
    }

    let totalForfeited = 0;
    for (const lot of lots) {
      const remaining = lot.remaining_credits as number;
      if (remaining <= 0) {
        continue;
      }
      totalForfeited += remaining;

      const { error: lotError } = await this.getDb()
        .from('organization_credit_lots')
        .update({ remaining_credits: 0 })
        .eq('id', lot.id);

      if (lotError) {
        throw new Error(lotError.message);
      }

      await this.getDb().from('organization_credit_transactions').insert({
        organization_id: organizationId,
        wallet_id: wallet.id,
        lot_id: lot.id,
        tx_type: 'expire',
        bucket_type: 'pack',
        credits_delta: -remaining,
        note: 'Cycle reset — pack credits do not carry over',
      });
    }

    if (totalForfeited <= 0) {
      return;
    }

    const { error: walletError } = await this.getDb()
      .from('organization_credit_wallets')
      .update({
        pack_credits_remaining: Math.max(0, wallet.pack_credits_remaining - totalForfeited),
      })
      .eq('organization_id', organizationId);

    if (walletError) {
      throw new Error(walletError.message);
    }
  }

  async fulfillPackPurchase(params: {
    organizationId: string;
    creditPackId: string;
    stripeCheckoutSessionId: string;
    stripeInvoiceId?: string | null;
  }): Promise<{ alreadyFulfilled: boolean }> {
    const { data: existingLot } = await this.getDb()
      .from('organization_credit_lots')
      .select('id')
      .eq('stripe_checkout_session_id', params.stripeCheckoutSessionId)
      .maybeSingle();

    if (existingLot?.id) {
      return { alreadyFulfilled: true };
    }

    const { data: pack, error: packError } = await this.getDb()
      .from('credit_packs')
      .select('*')
      .eq('id', params.creditPackId)
      .maybeSingle();

    if (packError || !pack) {
      throw new Error(`Credit pack ${params.creditPackId} not found`);
    }

    const policy = await this.getPolicyConfig();
    const purchasedAt = new Date();
    const expiresAt = new Date(purchasedAt);
    expiresAt.setDate(expiresAt.getDate() + policy.pack_expiry_days);

    const wallet = await this.ensureWallet(params.organizationId);

    const { data: lot, error: lotError } = await this.getDb()
      .from('organization_credit_lots')
      .insert({
        organization_id: params.organizationId,
        credit_pack_id: pack.id,
        purchased_credits: pack.credits_amount,
        remaining_credits: pack.credits_amount,
        purchased_at: purchasedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        stripe_checkout_session_id: params.stripeCheckoutSessionId,
        stripe_invoice_id: params.stripeInvoiceId ?? null,
      })
      .select('id')
      .single();

    if (lotError) {
      if (lotError.code === '23505') {
        return { alreadyFulfilled: true };
      }
      throw new Error(lotError.message);
    }

    const { error: walletError } = await this.getDb()
      .from('organization_credit_wallets')
      .update({
        pack_credits_remaining: wallet.pack_credits_remaining + pack.credits_amount,
      })
      .eq('organization_id', params.organizationId);

    if (walletError) {
      throw new Error(walletError.message);
    }

    await this.getDb().from('organization_credit_transactions').insert({
      organization_id: params.organizationId,
      wallet_id: wallet.id,
      lot_id: lot.id,
      tx_type: 'purchase',
      bucket_type: 'pack',
      credits_delta: pack.credits_amount,
      reference_id: params.stripeCheckoutSessionId,
      note: `Purchased pack ${pack.pack_key}`,
    });

    return { alreadyFulfilled: false };
  }

  async listActiveCreditPacks(): Promise<CreditPackCatalogItem[]> {
    const { data, error } = await this.getDb()
      .from('credit_packs')
      .select('pack_key, name, credits_amount, currency, unit_amount_cents')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return (data ?? []) as CreditPackCatalogItem[];
  }

  async createCreditPackCheckoutSession(params: {
    organizationId: string;
    packKey: string;
    billingEmail: string;
  }): Promise<{ url: string; sessionId: string }> {
    const { data: pack, error } = await this.getDb()
      .from('credit_packs')
      .select('*')
      .eq('pack_key', params.packKey.trim())
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!pack) {
      throw new NotFoundException('Credit pack not found or inactive');
    }

    if (
      !pack.stripe_price_id ||
      pack.stripe_price_id.includes(STRIPE_PLAN_PLACEHOLDER_MARKER)
    ) {
      throw new BadRequestException('Credit pack is not configured for Stripe checkout yet');
    }

    const stripe = this.billingService.getStripe();
    const { data: org } = await this.getDb()
      .from('organizations')
      .select('id, stripe_customer_id')
      .eq('id', params.organizationId)
      .single();

    let customerId = org?.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: params.billingEmail,
        metadata: { organization_id: params.organizationId },
      });
      customerId = customer.id;
      await this.getDb()
        .from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', params.organizationId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      client_reference_id: params.organizationId,
      line_items: [{ price: pack.stripe_price_id, quantity: 1 }],
      success_url: `${this.billingService.getCheckoutSuccessUrl()}?credit_pack=1`,
      cancel_url: this.billingService.getCheckoutCancelUrl(),
      metadata: {
        organization_id: params.organizationId,
        credit_pack_id: pack.id,
        credit_pack_key: pack.pack_key,
        checkout_flow: 'credit_pack',
      },
    });

    if (!session.url) {
      throw new InternalServerErrorException('Stripe did not return a checkout URL');
    }

    return { url: session.url, sessionId: session.id };
  }

  async listCreditPacksAdmin(): Promise<CreditPackRow[]> {
    const { data, error } = await this.getDb()
      .from('credit_packs')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data ?? []) as CreditPackRow[];
  }

  async syncCreditPacksFromStripe(): Promise<SyncCreditPacksFromStripeResult> {
    const stripe = this.billingService.getStripe();
    const result: SyncCreditPacksFromStripeResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: [],
    };

    const prices = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });

    for (const price of prices.data) {
      const product =
        price.product && typeof price.product !== 'string' ? price.product : null;
      const metadata = {
        ...(product && 'metadata' in product ? product.metadata : {}),
        ...price.metadata,
      };

      const packKey = metadata.credit_pack_key ?? metadata.pack_key;
      if (!packKey) {
        continue;
      }

      if (price.type !== 'one_time') {
        result.skipped += 1;
        continue;
      }

      const productName =
        product && 'name' in product && typeof product.name === 'string'
          ? product.name
          : packKey;

      const creditsRaw = metadata.credits_amount ?? metadata.credits;
      const creditsAmount = creditsRaw ? Number(creditsRaw) : NaN;
      if (!Number.isFinite(creditsAmount) || creditsAmount <= 0) {
        result.errors.push({
          pack_key: packKey,
          message: 'Missing or invalid credits_amount in Stripe metadata',
        });
        continue;
      }

      const productId =
        typeof price.product === 'string' ? price.product : price.product?.id ?? null;

      const row = {
        pack_key: packKey,
        name: productName,
        credits_amount: Math.floor(creditsAmount),
        stripe_product_id: productId,
        stripe_price_id: price.id,
        currency: price.currency,
        unit_amount_cents: price.unit_amount,
        is_active: price.active,
      };

      const { data: existing } = await this.getDb()
        .from('credit_packs')
        .select('id, name, credits_amount, stripe_product_id, stripe_price_id, currency, unit_amount_cents, is_active')
        .eq('pack_key', packKey)
        .maybeSingle();

      if (!existing) {
        const { error: insertError } = await this.getDb().from('credit_packs').insert(row);
        if (insertError) {
          result.errors.push({ pack_key: packKey, message: insertError.message });
        } else {
          result.created += 1;
        }
        continue;
      }

      const changed =
        existing.name !== row.name ||
        existing.credits_amount !== row.credits_amount ||
        existing.stripe_product_id !== row.stripe_product_id ||
        existing.stripe_price_id !== row.stripe_price_id ||
        existing.currency !== row.currency ||
        existing.unit_amount_cents !== row.unit_amount_cents ||
        existing.is_active !== row.is_active;

      if (!changed) {
        result.unchanged += 1;
        continue;
      }

      const { error: updateError } = await this.getDb()
        .from('credit_packs')
        .update(row)
        .eq('id', existing.id);

      if (updateError) {
        result.errors.push({ pack_key: packKey, message: updateError.message });
      } else {
        result.updated += 1;
      }
    }

    return result;
  }

  async listCapabilityCreditCosts(): Promise<CapabilityCreditCostAdminRow[]> {
    const { data: capabilities, error: capError } = await this.getDb()
      .from('ai_capabilities')
      .select('capability_key, display_name, description')
      .order('capability_key');

    if (capError) {
      throw new BadRequestException(capError.message);
    }

    const { data: costs, error: costError } = await this.getDb()
      .from('ai_capability_credit_costs')
      .select('*');

    if (costError) {
      throw new BadRequestException(costError.message);
    }

    const costMap = new Map(
      ((costs ?? []) as { capability_key: string; credits_cost: number; is_enabled: boolean; updated_at: string }[]).map(
        (c) => [c.capability_key, c],
      ),
    );

    return (capabilities ?? []).map((cap) => {
      const cost = costMap.get(cap.capability_key);
      return {
        capability_key: cap.capability_key,
        display_name: cap.display_name,
        description: cap.description,
        credits_cost: cost?.credits_cost ?? 0,
        is_enabled: cost?.is_enabled ?? false,
        updated_at: cost?.updated_at ?? new Date(0).toISOString(),
      };
    });
  }

  async updateCapabilityCreditCost(
    capabilityKey: string,
    dto: UpdateCapabilityCreditCostDto,
  ): Promise<CapabilityCreditCostAdminRow> {
    const patch = {
      credits_cost: dto.credits_cost,
      ...(dto.is_enabled !== undefined ? { is_enabled: dto.is_enabled } : {}),
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.getDb()
      .from('ai_capability_credit_costs')
      .upsert({ capability_key: capabilityKey, ...patch }, { onConflict: 'capability_key' });

    if (error) {
      throw new BadRequestException(error.message);
    }

    const rows = await this.listCapabilityCreditCosts();
    const row = rows.find((r) => r.capability_key === capabilityKey);
    if (!row) {
      throw new NotFoundException('Capability not found');
    }
    return row;
  }

  async getPolicyConfig(): Promise<CreditPolicyConfigRow> {
    const { data, error } = await this.getDb()
      .from('ai_credit_policy_config')
      .select('*')
      .eq('config_key', 'default')
      .single();

    if (error || !data) {
      throw new InternalServerErrorException('Credit policy config not found');
    }

    return data as CreditPolicyConfigRow;
  }

  async updateCreditPolicy(
    dto: UpdateCreditPolicyDto,
    updatedByUserId?: string,
  ): Promise<CreditPolicyConfigRow> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.pack_expiry_days !== undefined) patch.pack_expiry_days = dto.pack_expiry_days;
    if (dto.base_carryover_enabled !== undefined) {
      patch.base_carryover_enabled = dto.base_carryover_enabled;
    }
    if (dto.pack_carryover_until_expiry !== undefined) {
      patch.pack_carryover_until_expiry = dto.pack_carryover_until_expiry;
    }
    if (dto.carryover_cap_credits !== undefined) {
      patch.carryover_cap_credits = dto.carryover_cap_credits;
    }
    if (dto.upgrade_proration_mode !== undefined) {
      patch.upgrade_proration_mode = dto.upgrade_proration_mode;
    }
    if (dto.downgrade_effective_mode !== undefined) {
      patch.downgrade_effective_mode = dto.downgrade_effective_mode;
    }
    if (updatedByUserId) {
      patch.updated_by_user_id = updatedByUserId;
    }

    const { data, error } = await this.getDb()
      .from('ai_credit_policy_config')
      .update(patch)
      .eq('config_key', 'default')
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data as CreditPolicyConfigRow;
  }

  async listAdminWallets(query: ListAdminCreditWalletsQueryDto) {
    let q = this.getDb()
      .from('organization_credit_wallets')
      .select(
        `
        *,
        organizations ( id, name )
      `,
      )
      .order('updated_at', { ascending: false })
      .limit(query.limit ?? 50);

    if (query.organization_id) {
      q = q.eq('organization_id', query.organization_id);
    } else if (query.q?.trim()) {
      const term = query.q.trim();
      const { data: orgs } = await this.getDb()
        .from('organizations')
        .select('id')
        .ilike('name', `%${term}%`)
        .limit(20);

      const orgIds = (orgs ?? []).map((o) => o.id);
      if (orgIds.length === 0) {
        return [];
      }
      q = q.in('organization_id', orgIds);
    }

    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(error.message);
    }
    return data ?? [];
  }

  async listAdminTransactions(query: ListAdminCreditTransactionsQueryDto): Promise<CreditTransactionRow[]> {
    let q = this.getDb()
      .from('organization_credit_transactions')
      .select('*')
      .order('occurred_at', { ascending: false })
      .range(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50) - 1);

    if (query.organization_id) {
      q = q.eq('organization_id', query.organization_id);
    }
    if (query.tx_type) {
      q = q.eq('tx_type', query.tx_type);
    }
    if (query.bucket_type) {
      q = q.eq('bucket_type', query.bucket_type);
    }
    if (query.from) {
      q = q.gte('occurred_at', query.from);
    }
    if (query.to) {
      q = q.lte('occurred_at', query.to);
    }

    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data ?? []) as CreditTransactionRow[];
  }

  async expireExpiredLots(): Promise<{ expiredLots: number; creditsExpired: number }> {
    const now = new Date().toISOString();
    const { data: lots, error } = await this.getDb()
      .from('organization_credit_lots')
      .select('*')
      .gt('remaining_credits', 0)
      .lt('expires_at', now);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    let expiredLots = 0;
    let creditsExpired = 0;

    for (const lot of lots ?? []) {
      const remaining = lot.remaining_credits as number;
      if (remaining <= 0) continue;

      const { data: wallet } = await this.getDb()
        .from('organization_credit_wallets')
        .select('id, pack_credits_remaining')
        .eq('organization_id', lot.organization_id)
        .maybeSingle();

      await this.getDb()
        .from('organization_credit_lots')
        .update({ remaining_credits: 0 })
        .eq('id', lot.id);

      if (wallet) {
        await this.getDb()
          .from('organization_credit_wallets')
          .update({
            pack_credits_remaining: Math.max(0, wallet.pack_credits_remaining - remaining),
          })
          .eq('id', wallet.id);

        await this.getDb().from('organization_credit_transactions').insert({
          organization_id: lot.organization_id,
          wallet_id: wallet.id,
          lot_id: lot.id,
          tx_type: 'expire',
          bucket_type: 'pack',
          credits_delta: -remaining,
          note: 'Pack lot expired',
        });
      }

      expiredLots += 1;
      creditsExpired += remaining;
    }

    return { expiredLots, creditsExpired };
  }
}
