import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistantService } from './assistant.service';
import { InsufficientCreditsException } from '../credits/credits.errors';
import { CapabilityBlockedException } from '../entitlements/capability-blocked.exception';
import type { CreditsService } from '../credits/credits.service';
import type { EntitlementCheckService } from '../entitlements/entitlement-check.service';
import type { LlmChatsService } from '../llm-chats/llm-chats.service';
import type { AssistantPendingActionService } from './assistant-pending-action.service';
import type { AssistantRuntimeService } from './assistant-runtime.service';
import type { AssistantToolExecutorService } from './assistant-tool-executor.service';
import type { AssistantToolPolicyService } from './assistant-tool-policy.service';
import type { TestLogService } from '../common/test-log.service';

type Conversation = {
  id: string;
  organization_client_id: string | null;
};

function makeConfig(assistantEnabled: boolean | undefined): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'supabase.url') return 'https://example.supabase.co';
      if (key === 'supabase.serviceRoleKey') return 'service-key';
      if (key === 'ASSISTANT_ENABLED') {
        if (assistantEnabled === undefined) return undefined;
        return assistantEnabled ? 'true' : 'false';
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

const testLog = { log: () => {} } as unknown as TestLogService;

describe('AssistantService billing gates', () => {
  const conversation: Conversation = {
    id: 'conv-1',
    organization_client_id: null,
  };

  let callOrder: string[];
  let llmChats: LlmChatsService;
  let credits: CreditsService;
  let entitlement: EntitlementCheckService;
  let runtime: AssistantRuntimeService;
  let pendingActions: AssistantPendingActionService;
  let toolExecutor: AssistantToolExecutorService;
  let toolPolicy: AssistantToolPolicyService;
  let service: AssistantService;

  const stubDeps = () => {
    pendingActions = {} as AssistantPendingActionService;
    toolExecutor = {} as AssistantToolExecutorService;
    toolPolicy = {} as AssistantToolPolicyService;
  };

  beforeEach(() => {
    callOrder = [];

    llmChats = {
      getOwnedConversation: async () => {
        callOrder.push('getOwnedConversation');
        return conversation;
      },
      insertMessageInternal: async (params: { role: string }) => {
        callOrder.push(`insertMessageInternal:${params.role}`);
        return { id: `${params.role}-msg`, role: params.role, content: 'test' };
      },
    } as unknown as LlmChatsService;

    credits = {
      consume: async () => {
        callOrder.push('consume');
        return { consumed: 1, remainingCredits: 99 };
      },
    } as unknown as CreditsService;

    entitlement = {
      assertAllowed: async () => {
        callOrder.push('assertAllowed');
      },
    } as unknown as EntitlementCheckService;

    runtime = {
      loadPromptBundle: async () => {
        callOrder.push('loadPromptBundle');
        return { systemText: 'system', taskText: 'task' };
      },
      runTurn: async () => {
        callOrder.push('runTurn');
        return {
          reply: 'Hello',
          toolsUsed: ['tool.org.summary'],
          model: 'gemini',
          latencyMs: 100,
        };
      },
    } as unknown as AssistantRuntimeService;

    stubDeps();
    service = new AssistantService(
      makeConfig(true),
      llmChats,
      credits,
      entitlement,
      runtime,
      pendingActions,
      toolExecutor,
      toolPolicy,
      testLog,
    );

    const historyChain = {
      select: () => historyChain,
      eq: () => historyChain,
      order: () => historyChain,
      limit: async () => ({
        data: [{ role: 'user', content: 'prior' }],
        error: null,
      }),
    };
    const touchChain = {
      update: () => touchChain,
      eq: async () => ({ error: null }),
    };
    (service as unknown as { adminClient: { from: (table: string) => typeof historyChain | typeof touchChain } }).adminClient = {
      from: (table: string) => {
        if (table === 'organization_llm_messages') return historyChain;
        if (table === 'organization_llm_conversations') return touchChain;
        throw new Error(`unexpected table ${table}`);
      },
    };
  });

  it('throws 503 when assistant is disabled before billing checks', async () => {
    stubDeps();
    service = new AssistantService(
      makeConfig(false),
      llmChats,
      credits,
      entitlement,
      runtime,
      pendingActions,
      toolExecutor,
      toolPolicy,
      testLog,
    );

    await assert.rejects(
      () => service.runAssistantTurn('org-1', 'user-1', 'conv-1', { content: 'hello' }),
      (err: unknown) => {
        assert.ok(err instanceof ServiceUnavailableException);
        return true;
      },
    );
    assert.deepEqual(callOrder, []);
  });

  it('runs entitlement before consume and LLM', async () => {
    await service.runAssistantTurn('org-1', 'user-1', 'conv-1', { content: 'hello' });

    const entitlementIdx = callOrder.indexOf('assertAllowed');
    const consumeIdx = callOrder.indexOf('consume');
    const runTurnIdx = callOrder.indexOf('runTurn');
    assert.ok(entitlementIdx >= 0);
    assert.ok(consumeIdx > entitlementIdx);
    assert.ok(runTurnIdx > consumeIdx);
  });

  it('propagates 402 when credits are insufficient without calling LLM', async () => {
    credits = {
      consume: async () => {
        callOrder.push('consume');
        throw new InsufficientCreditsException({
          capabilityKey: 'chat.global',
          requiredCredits: 5,
          remainingCredits: 0,
        });
      },
    } as unknown as CreditsService;
    stubDeps();
    service = new AssistantService(
      makeConfig(true),
      llmChats,
      credits,
      entitlement,
      runtime,
      pendingActions,
      toolExecutor,
      toolPolicy,
      testLog,
    );
    (service as unknown as { adminClient: object }).adminClient = {
      from: () => {
        throw new Error('supabase should not be called');
      },
    };

    await assert.rejects(
      () => service.runAssistantTurn('org-1', 'user-1', 'conv-1', { content: 'hello' }),
      (err: unknown) => {
        assert.ok(err instanceof HttpException);
        assert.equal(err.getStatus(), HttpStatus.PAYMENT_REQUIRED);
        const body = err.getResponse() as Record<string, unknown>;
        assert.equal(body.reason, 'insufficient_credits');
        return true;
      },
    );
    assert.ok(!callOrder.includes('runTurn'));
    assert.ok(!callOrder.some((c) => c.startsWith('insertMessageInternal')));
  });

  it('propagates 403 blocked_by_plan without consuming credits', async () => {
    entitlement = {
      assertAllowed: async () => {
        callOrder.push('assertAllowed');
        throw new CapabilityBlockedException({
          capabilityKey: 'chat.global',
          reason: 'blocked_by_plan',
          message: 'Upgrade your plan.',
          planKey: 'starter',
        });
      },
    } as unknown as EntitlementCheckService;
    stubDeps();
    service = new AssistantService(
      makeConfig(true),
      llmChats,
      credits,
      entitlement,
      runtime,
      pendingActions,
      toolExecutor,
      toolPolicy,
      testLog,
    );

    await assert.rejects(
      () => service.runAssistantTurn('org-1', 'user-1', 'conv-1', { content: 'hello' }),
      (err: unknown) => {
        assert.ok(err instanceof HttpException);
        assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
        const body = err.getResponse() as Record<string, unknown>;
        assert.equal(body.code, 'CAPABILITY_BLOCKED');
        assert.equal(body.reason, 'blocked_by_plan');
        return true;
      },
    );
    assert.ok(!callOrder.includes('consume'));
    assert.ok(!callOrder.includes('runTurn'));
  });

  it('propagates 403 disabled_by_policy without consuming credits', async () => {
    entitlement = {
      assertAllowed: async () => {
        callOrder.push('assertAllowed');
        throw new CapabilityBlockedException({
          capabilityKey: 'chat.global',
          reason: 'disabled_by_policy',
          message: 'Disabled by policy.',
        });
      },
    } as unknown as EntitlementCheckService;
    stubDeps();
    service = new AssistantService(
      makeConfig(true),
      llmChats,
      credits,
      entitlement,
      runtime,
      pendingActions,
      toolExecutor,
      toolPolicy,
      testLog,
    );

    await assert.rejects(
      () => service.runAssistantTurn('org-1', 'user-1', 'conv-1', { content: 'hello' }),
      (err: unknown) => {
        assert.ok(err instanceof HttpException);
        assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
        const body = err.getResponse() as Record<string, unknown>;
        assert.equal(body.reason, 'disabled_by_policy');
        return true;
      },
    );
    assert.ok(!callOrder.includes('consume'));
  });

  it('uses chat.client capability for client-scoped conversations', async () => {
    let capturedKey: string | undefined;
    entitlement = {
      assertAllowed: async (params: { capabilityKey: string }) => {
        callOrder.push('assertAllowed');
        capturedKey = params.capabilityKey;
      },
    } as unknown as EntitlementCheckService;
    llmChats = {
      getOwnedConversation: async () => {
        callOrder.push('getOwnedConversation');
        return { id: 'conv-2', organization_client_id: 'client-1' };
      },
      insertMessageInternal: async (params: { role: string }) => {
        callOrder.push(`insertMessageInternal:${params.role}`);
        return { id: `${params.role}-msg`, role: params.role, content: 'test' };
      },
    } as unknown as LlmChatsService;
    stubDeps();
    service = new AssistantService(
      makeConfig(true),
      llmChats,
      credits,
      entitlement,
      runtime,
      pendingActions,
      toolExecutor,
      toolPolicy,
      testLog,
    );
    const historyChain = {
      select: () => historyChain,
      eq: () => historyChain,
      order: () => historyChain,
      limit: async () => ({ data: [], error: null }),
    };
    const touchChain = {
      update: () => touchChain,
      eq: async () => ({ error: null }),
    };
    (service as unknown as { adminClient: { from: (table: string) => typeof historyChain | typeof touchChain } }).adminClient = {
      from: (table: string) => {
        if (table === 'organization_llm_messages') return historyChain;
        if (table === 'organization_llm_conversations') return touchChain;
        throw new Error(`unexpected table ${table}`);
      },
    };

    await service.runAssistantTurn('org-1', 'user-1', 'conv-2', { content: 'hello' });
    assert.equal(capturedKey, 'chat.client');
  });

  it('returns creditsRemaining on successful turn', async () => {
    const result = await service.runAssistantTurn('org-1', 'user-1', 'conv-1', {
      content: 'hello',
    });
    assert.equal(result.creditsRemaining, 99);
    assert.deepEqual(result.toolsUsed, ['tool.org.summary']);
  });

  it('returns null creditsRemaining when consume is skipped', async () => {
    credits = {
      consume: async () => {
        callOrder.push('consume');
        return { skipped: true };
      },
    } as unknown as CreditsService;
    stubDeps();
    service = new AssistantService(
      makeConfig(true),
      llmChats,
      credits,
      entitlement,
      runtime,
      pendingActions,
      toolExecutor,
      toolPolicy,
      testLog,
    );
    const historyChain = {
      select: () => historyChain,
      eq: () => historyChain,
      order: () => historyChain,
      limit: async () => ({ data: [], error: null }),
    };
    const touchChain = {
      update: () => touchChain,
      eq: async () => ({ error: null }),
    };
    (service as unknown as { adminClient: { from: (table: string) => typeof historyChain | typeof touchChain } }).adminClient = {
      from: (table: string) => {
        if (table === 'organization_llm_messages') return historyChain;
        if (table === 'organization_llm_conversations') return touchChain;
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await service.runAssistantTurn('org-1', 'user-1', 'conv-1', {
      content: 'hello',
    });
    assert.equal(result.creditsRemaining, null);
  });
});
