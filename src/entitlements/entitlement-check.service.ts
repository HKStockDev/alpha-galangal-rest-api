import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CapabilityBlockedException } from './capability-blocked.exception';
import type { EntitlementCheckResult } from './entitlement-check.types';

const ENTITLEMENT_SELECT =
  'is_enabled, hard_block, quota_period, quota_limit, upsell_message';

const ACTIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due'] as const;

@Injectable()
export class EntitlementCheckService {
  private readonly logger = new Logger(EntitlementCheckService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private getDb(): SupabaseClient {
    if (!this.adminClient) {
      throw new BadRequestException('Service unavailable');
    }
    return this.adminClient;
  }

  async checkOrganizationCapability(params: {
    organizationId: string;
    capabilityKey: string;
    organizationClientId?: string | null;
  }): Promise<EntitlementCheckResult> {
    const { organizationId, capabilityKey, organizationClientId } = params;

    const { data: policy, error: policyError } = await this.getDb()
      .from('ai_capability_policies')
      .select('is_enabled, requires_confirmation')
      .eq('capability_key', capabilityKey)
      .maybeSingle();

    if (policyError) {
      this.logger.error(`ai_capability_policies: ${policyError.message}`);
      throw new BadRequestException('Could not load capability policy');
    }

    if (policy && !policy.is_enabled) {
      return {
        allowed: false,
        reason: 'disabled_by_policy',
        capabilityKey,
        message: 'This capability is disabled by platform policy.',
      };
    }

    const { data: capability, error: capError } = await this.getDb()
      .from('ai_capabilities')
      .select('capability_key, display_name')
      .eq('capability_key', capabilityKey)
      .maybeSingle();

    if (capError || !capability) {
      throw new NotFoundException(`Capability not found: ${capabilityKey}`);
    }

    const displayName = (capability as { display_name: string }).display_name;
    const defaultUpsell = `Upgrade your plan to access ${displayName}.`;

    const { data: sub, error: subError } = await this.getDb()
      .from('organization_subscriptions')
      .select(
        `
        plan_id,
        status,
        subscription_plans ( plan_key, display_name )
      `,
      )
      .eq('organization_id', organizationId)
      .in('status', [...ACTIVE_SUBSCRIPTION_STATUSES])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subError) {
      this.logger.error(`organization_subscriptions: ${subError.message}`);
      throw new BadRequestException('Could not load subscription');
    }

    let planKey: string | undefined;
    if (!sub?.plan_id) {
      return {
        allowed: false,
        reason: 'blocked_by_plan',
        capabilityKey,
        message: defaultUpsell,
      };
    }

    if (sub.plan_id) {
      const plan = sub.subscription_plans as
        | { plan_key: string; display_name: string | null }
        | { plan_key: string; display_name: string | null }[]
        | null;
      const planRow = Array.isArray(plan) ? plan[0] : plan;
      planKey = planRow?.plan_key;

      const { data: entitlement, error: entError } = await this.getDb()
        .from('subscription_plan_entitlements')
        .select(ENTITLEMENT_SELECT)
        .eq('plan_id', sub.plan_id)
        .eq('capability_key', capabilityKey)
        .maybeSingle();

      if (entError) {
        throw new BadRequestException('Could not load plan entitlement');
      }

      if (!entitlement || !entitlement.is_enabled) {
        return {
          allowed: false,
          reason: 'blocked_by_plan',
          capabilityKey,
          message: (entitlement?.upsell_message as string | null)?.trim() || defaultUpsell,
          planKey,
        };
      }

      if (entitlement.hard_block) {
        return {
          allowed: false,
          reason: 'hard_block',
          capabilityKey,
          message: (entitlement.upsell_message as string | null)?.trim() || defaultUpsell,
          planKey,
        };
      }
    }

    const { data: scopePolicy } = await this.getDb()
      .from('ai_scope_policies')
      .select('require_active_client_for_client_actions')
      .eq('policy_key', 'default')
      .maybeSingle();

    const clientScopedCapabilities = new Set(['chat.client', 'client.lookup']);
    if (
      scopePolicy?.require_active_client_for_client_actions &&
      clientScopedCapabilities.has(capabilityKey) &&
      !organizationClientId
    ) {
      return {
        allowed: false,
        reason: 'missing_scope',
        capabilityKey,
        message: 'Select or open a client-scoped conversation for this action.',
      };
    }

    return {
      allowed: true,
      needsConfirmation: Boolean(policy?.requires_confirmation),
    };
  }

  async assertAllowed(params: {
    organizationId: string;
    capabilityKey: string;
    organizationClientId?: string | null;
  }): Promise<void> {
    const result = await this.checkOrganizationCapability(params);
    if (!result.allowed) {
      throw new CapabilityBlockedException({
        capabilityKey: result.capabilityKey,
        reason: result.reason,
        message: result.message,
        planKey: result.planKey,
      });
    }
  }
}
