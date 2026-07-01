import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExecutionContext, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { BillingEntitlementGuard } from './guards/billing-entitlement.guard';
import type { BillingService } from './billing.service';

function mockContext(params: {
  user?: { isPlatformAdmin?: boolean; sub?: string } | null;
  organizationId?: string;
}): ExecutionContext {
  const request = {
    user: params.user ?? null,
    params: { organizationId: params.organizationId ?? 'org-1' },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe('BillingEntitlementGuard', () => {
  it('throws 402 when organization is not entitled', async () => {
    const billingService = {
      getOrganizationBillingStatus: async () => ({ is_entitled: false }),
    } as unknown as BillingService;
    const guard = new BillingEntitlementGuard(billingService);

    await assert.rejects(
      () => guard.canActivate(mockContext({ user: { sub: 'user-1' } })),
      (err: unknown) => {
        assert.ok(err instanceof HttpException);
        assert.equal(err.getStatus(), HttpStatus.PAYMENT_REQUIRED);
        const body = err.getResponse() as Record<string, unknown>;
        assert.match(String(body.message), /subscription or trial/i);
        return true;
      },
    );
  });

  it('allows when organization is entitled', async () => {
    let called = false;
    const billingService = {
      getOrganizationBillingStatus: async (orgId: string) => {
        called = true;
        assert.equal(orgId, 'org-1');
        return { is_entitled: true };
      },
    } as unknown as BillingService;
    const guard = new BillingEntitlementGuard(billingService);

    const allowed = await guard.canActivate(mockContext({ user: { sub: 'user-1' } }));
    assert.equal(allowed, true);
    assert.equal(called, true);
  });

  it('bypasses billing lookup for platform admins', async () => {
    let called = false;
    const billingService = {
      getOrganizationBillingStatus: async () => {
        called = true;
        return { is_entitled: false };
      },
    } as unknown as BillingService;
    const guard = new BillingEntitlementGuard(billingService);

    const allowed = await guard.canActivate(
      mockContext({ user: { sub: 'admin-1', isPlatformAdmin: true } }),
    );
    assert.equal(allowed, true);
    assert.equal(called, false);
  });

  it('throws ForbiddenException when user is missing', async () => {
    const billingService = {
      getOrganizationBillingStatus: async () => ({ is_entitled: true }),
    } as unknown as BillingService;
    const guard = new BillingEntitlementGuard(billingService);

    await assert.rejects(
      () => guard.canActivate(mockContext({ user: null })),
      ForbiddenException,
    );
  });
});
