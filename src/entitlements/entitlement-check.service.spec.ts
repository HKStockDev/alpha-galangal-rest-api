import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { EntitlementCheckService } from './entitlement-check.service';

type ChainResult = { data: unknown; error: unknown };

function chain(result: ChainResult) {
  const api = {
    select: () => api,
    eq: () => api,
    in: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => result,
  };
  return api;
}

describe('EntitlementCheckService', () => {
  let mockFrom: (table: string) => ReturnType<typeof chain>;
  let fromCalls: string[];

  const config = {
    get: (key: string) => {
      if (key === 'supabase.url') return 'https://example.supabase.co';
      if (key === 'supabase.serviceRoleKey') return 'service-key';
      return undefined;
    },
  } as unknown as ConfigService;

  let service: EntitlementCheckService;

  beforeEach(() => {
    fromCalls = [];
    mockFrom = (table: string) => {
      fromCalls.push(table);
      return chain({ data: null, error: null });
    };
    service = new EntitlementCheckService(config);
    (service as unknown as { adminClient: { from: typeof mockFrom } }).adminClient = {
      from: mockFrom,
    };
  });

  it('blocks when capability policy is disabled', async () => {
    mockFrom = (table: string) => {
      fromCalls.push(table);
      if (table === 'ai_capability_policies') {
        return chain({ data: { is_enabled: false, requires_confirmation: false }, error: null });
      }
      if (table === 'ai_capabilities') {
        return chain({
          data: { capability_key: 'chat.global', display_name: 'Global Chat' },
          error: null,
        });
      }
      return chain({ data: null, error: null });
    };
    (service as unknown as { adminClient: { from: typeof mockFrom } }).adminClient = {
      from: mockFrom,
    };

    const result = await service.checkOrganizationCapability({
      organizationId: 'org-1',
      capabilityKey: 'chat.global',
    });

    assert.equal(result.allowed, false);
    if (!result.allowed) {
      assert.equal(result.reason, 'disabled_by_policy');
    }
  });

  it('allows when policy and plan entitlement are enabled', async () => {
    mockFrom = (table: string) => {
      fromCalls.push(table);
      if (table === 'ai_capability_policies') {
        return chain({ data: { is_enabled: true, requires_confirmation: false }, error: null });
      }
      if (table === 'ai_capabilities') {
        return chain({
          data: { capability_key: 'chat.global', display_name: 'Global Chat' },
          error: null,
        });
      }
      if (table === 'organization_subscriptions') {
        return chain({
          data: {
            plan_id: 'plan-1',
            status: 'active',
            subscription_plans: { plan_key: 'pro', display_name: 'Pro' },
          },
          error: null,
        });
      }
      if (table === 'subscription_plan_entitlements') {
        return chain({
          data: { is_enabled: true, hard_block: false, upsell_message: null },
          error: null,
        });
      }
      if (table === 'ai_scope_policies') {
        return chain({
          data: { require_active_client_for_client_actions: true },
          error: null,
        });
      }
      return chain({ data: null, error: null });
    };
    (service as unknown as { adminClient: { from: typeof mockFrom } }).adminClient = {
      from: mockFrom,
    };

    const result = await service.checkOrganizationCapability({
      organizationId: 'org-1',
      capabilityKey: 'chat.global',
    });

    assert.equal(result.allowed, true);
    assert.ok(fromCalls.length > 0);
  });
});
