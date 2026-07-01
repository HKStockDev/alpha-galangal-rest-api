import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditsService } from './credits.service';
import type { BillingService } from '../billing/billing.service';

describe('CreditsService.consume', () => {
  let rpcResult: { data: unknown; error: { message: string } | null };
  let rpcCalls: Array<Record<string, unknown>>;

  const config = {
    get: (key: string) => {
      if (key === 'supabase.url') return 'https://example.supabase.co';
      if (key === 'supabase.serviceRoleKey') return 'service-key';
      return undefined;
    },
  } as unknown as ConfigService;

  const billingService = {} as BillingService;

  let service: CreditsService;

  beforeEach(() => {
    rpcCalls = [];
    rpcResult = { data: null, error: null };
    service = new CreditsService(config, billingService);
    (service as unknown as { adminClient: { rpc: (name: string, args: Record<string, unknown>) => Promise<typeof rpcResult> } }).adminClient = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, 'consume_org_credits');
        rpcCalls.push(args);
        return rpcResult;
      },
    };
  });

  it('returns skipped when RPC marks consumption as skipped', async () => {
    rpcResult = { data: { skipped: true }, error: null };

    const result = await service.consume({
      organizationId: 'org-1',
      capabilityKey: 'chat.global',
      referenceId: 'conv-1',
    });

    assert.deepEqual(result, { skipped: true });
    assert.deepEqual(rpcCalls[0], {
      p_organization_id: 'org-1',
      p_capability_key: 'chat.global',
      p_reference_id: 'conv-1',
    });
  });

  it('throws 402 CAPABILITY_BLOCKED when credits are insufficient', async () => {
    rpcResult = {
      data: {
        error: 'insufficient_credits',
        required_credits: 5,
        remaining_credits: 0,
      },
      error: null,
    };

    await assert.rejects(
      () =>
        service.consume({
          organizationId: 'org-1',
          capabilityKey: 'chat.global',
        }),
      (err: unknown) => {
        assert.ok(err instanceof HttpException);
        assert.equal(err.getStatus(), HttpStatus.PAYMENT_REQUIRED);
        const body = err.getResponse() as Record<string, unknown>;
        assert.equal(body.code, 'CAPABILITY_BLOCKED');
        assert.equal(body.reason, 'insufficient_credits');
        assert.equal(body.required_credits, 5);
        assert.equal(body.remaining_credits, 0);
        return true;
      },
    );
  });

  it('returns consumed and remaining credits on success', async () => {
    rpcResult = {
      data: { consumed: 2, remaining_credits: 98 },
      error: null,
    };

    const result = await service.consume({
      organizationId: 'org-1',
      capabilityKey: 'chat.client',
      referenceId: 'conv-2',
    });

    assert.deepEqual(result, { consumed: 2, remainingCredits: 98 });
  });
});
