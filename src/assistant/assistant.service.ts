import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CreditsService } from '../credits/credits.service';
import { EntitlementCheckService } from '../entitlements/entitlement-check.service';
import { TestLogService } from '../common/test-log.service';
import { LlmChatsService } from '../llm-chats/llm-chats.service';
import { AssistantRuntimeService } from './assistant-runtime.service';
import { AssistantPendingActionService } from './assistant-pending-action.service';
import { AssistantToolExecutorService } from './assistant-tool-executor.service';
import { AssistantToolPolicyService } from './assistant-tool-policy.service';
import { MVP_ALL_TOOL_KEYS } from './assistant.constants';

@Injectable()
export class AssistantService {
  private adminClient: SupabaseClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly llmChats: LlmChatsService,
    private readonly credits: CreditsService,
    private readonly entitlement: EntitlementCheckService,
    private readonly runtime: AssistantRuntimeService,
    private readonly pendingActions: AssistantPendingActionService,
    private readonly toolExecutor: AssistantToolExecutorService,
    private readonly toolPolicy: AssistantToolPolicyService,
    private readonly testLog: TestLogService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private supabase(): SupabaseClient {
    if (!this.adminClient) {
      throw new BadRequestException('Service unavailable');
    }
    return this.adminClient;
  }

  private isAssistantEnabled(): boolean {
    const flag = this.config.get<string>('ASSISTANT_ENABLED');
    if (flag === undefined || flag === '') return true;
    return flag.toLowerCase() === 'true' || flag === '1';
  }

  async runAssistantTurn(
    organizationId: string,
    userId: string,
    conversationId: string,
    input: {
      content?: string;
      confirmActionId?: string;
      rejectActionId?: string;
    },
  ) {
    this.testLog.log('AssistantService.runAssistantTurn', 'input', {
      organizationId,
      userId,
      conversationId,
      content: input.content,
      confirmActionId: input.confirmActionId,
      rejectActionId: input.rejectActionId,
    });

    if (!this.isAssistantEnabled()) {
      throw new ServiceUnavailableException(
        'The AI assistant is temporarily unavailable.',
      );
    }

    const conversation = await this.llmChats.getOwnedConversation(
      organizationId,
      userId,
      conversationId,
    );

    const capabilityKey =
      conversation.organization_client_id != null ? 'chat.client' : 'chat.global';

    await this.entitlement.assertAllowed({
      organizationId,
      capabilityKey,
      organizationClientId: conversation.organization_client_id as string | null,
    });

    if (input.rejectActionId) {
      const result = await this.rejectPendingAction({
        organizationId,
        userId,
        conversationId,
        actionId: input.rejectActionId,
        capabilityKey,
      });
      this.testLog.log('AssistantService.runAssistantTurn', 'output', {
        organizationId,
        conversationId,
        action: 'reject',
        assistantContent: result.assistantMessage.content,
        toolsUsed: result.toolsUsed,
      });
      return result;
    }

    if (input.confirmActionId) {
      const result = await this.confirmPendingAction({
        organizationId,
        userId,
        conversationId,
        actionId: input.confirmActionId,
        capabilityKey,
      });
      this.testLog.log('AssistantService.runAssistantTurn', 'output', {
        organizationId,
        conversationId,
        action: 'confirm',
        assistantContent: result.assistantMessage.content,
        toolsUsed: result.toolsUsed,
        toolErrors: result.toolErrors,
      });
      return result;
    }

    const content = input.content?.trim() ?? '';
    if (!content) {
      throw new BadRequestException('content is required');
    }

    const consumeResult = await this.credits.consume({
      organizationId,
      capabilityKey,
      referenceId: conversationId,
    });

    const userMessage = await this.llmChats.insertMessageInternal({
      conversationId,
      role: 'user',
      content,
      metadata_json: {},
    });

    const { data: historyRows, error: histError } = await this.supabase()
      .from('organization_llm_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(30);

    if (histError) {
      throw new BadRequestException(histError.message);
    }

    const history = (historyRows ?? [])
      .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
      .slice(0, -1)
      .map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      }));

    const promptBundle = await this.runtime.loadPromptBundle({
      organization_client_id: conversation.organization_client_id as string | null,
    });

    let runResult: {
      reply: string;
      toolsUsed: string[];
      model: string;
      latencyMs: number;
      toolErrors: Array<{ toolKey: string; message: string }>;
      pendingAction?: {
        id: string;
        toolKey: string;
        capabilityKey: string;
        summary: string;
        expiresAt: string;
      };
    };

    try {
      runResult = await this.runtime.runTurn({
        userMessage: content,
        history,
        conversationId,
        ctx: {
          organizationId,
          userId,
          organizationClientId: conversation.organization_client_id as string | null,
        },
        contextJson: {
          systemText: `${promptBundle.systemText}\n\n${promptBundle.taskText}`,
          organization_id: organizationId,
          user_id: userId,
          organization_client_id: conversation.organization_client_id,
          allowed_tools: [...MVP_ALL_TOOL_KEYS],
        },
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Assistant run failed';
      const assistantMessage = await this.llmChats.insertMessageInternal({
        conversationId,
        role: 'assistant',
        content:
          'Sorry, I could not complete that request. Please try again in a moment.',
        metadata_json: { error: errMsg },
      });
      await this.touchConversation(conversationId);
      const remainingCredits =
        'remainingCredits' in consumeResult
          ? consumeResult.remainingCredits
          : undefined;
      const errorResult = {
        userMessage,
        assistantMessage,
        creditsRemaining: remainingCredits ?? null,
        toolsUsed: [] as string[],
        error: errMsg,
      };
      this.testLog.log('AssistantService.runAssistantTurn', 'output', {
        organizationId,
        conversationId,
        userContent: content,
        assistantContent: assistantMessage.content,
        error: errMsg,
      });
      return errorResult;
    }

    const assistantMessage = await this.llmChats.insertMessageInternal({
      conversationId,
      role: 'assistant',
      content: runResult.reply,
      metadata_json: {
        toolsUsed: runResult.toolsUsed,
        toolErrors: runResult.toolErrors,
        model: runResult.model,
        latencyMs: runResult.latencyMs,
        pendingAction: runResult.pendingAction ?? null,
      },
    });

    await this.touchConversation(conversationId);

    const remainingCredits =
      'remainingCredits' in consumeResult
        ? consumeResult.remainingCredits
        : undefined;

    const result = {
      userMessage,
      assistantMessage,
      creditsRemaining: remainingCredits ?? null,
      toolsUsed: runResult.toolsUsed,
      toolErrors: runResult.toolErrors,
      pendingAction: runResult.pendingAction ?? null,
    };

    this.testLog.log('AssistantService.runAssistantTurn', 'output', {
      organizationId,
      conversationId,
      userContent: content,
      assistantContent: runResult.reply,
      model: runResult.model,
      latencyMs: runResult.latencyMs,
      toolsUsed: runResult.toolsUsed,
      toolErrors: runResult.toolErrors,
      pendingAction: runResult.pendingAction ?? null,
    });

    return result;
  }

  private async confirmPendingAction(params: {
    organizationId: string;
    userId: string;
    conversationId: string;
    actionId: string;
    capabilityKey: string;
  }) {
    const chatConsume = await this.credits.consume({
      organizationId: params.organizationId,
      capabilityKey: params.capabilityKey,
      referenceId: params.conversationId,
    });

    const pending = await this.pendingActions.getPendingForUser({
      actionId: params.actionId,
      organizationId: params.organizationId,
      userId: params.userId,
      conversationId: params.conversationId,
    });

    const conversation = await this.llmChats.getOwnedConversation(
      params.organizationId,
      params.userId,
      params.conversationId,
    );

    await this.toolPolicy.assertToolAllowed({
      organizationId: params.organizationId,
      capabilityKey: pending.capability_key,
      organizationClientId: conversation.organization_client_id as string | null,
    });

    const toolCredits = await this.toolPolicy.consumeToolCredits({
      organizationId: params.organizationId,
      capabilityKey: pending.capability_key,
      referenceId: pending.id,
    });

    let toolResult: unknown;
    let toolError: string | undefined;
    try {
      toolResult = await this.toolExecutor.execute(
        pending.tool_key,
        pending.args_json,
        {
          organizationId: params.organizationId,
          userId: params.userId,
          organizationClientId: conversation.organization_client_id as string | null,
        },
      );
      await this.pendingActions.resolve(pending.id, 'confirmed');
    } catch (e) {
      toolError = e instanceof Error ? e.message : 'Tool execution failed';
      toolResult = { error: toolError };
    }

    const userMessage = await this.llmChats.insertMessageInternal({
      conversationId: params.conversationId,
      role: 'user',
      content: `Confirmed: ${pending.summary}`,
      metadata_json: { pending_action_id: pending.id, action: 'confirm' },
    });

    const replyText = toolError
      ? `I could not complete "${pending.summary}": ${toolError}`
      : `Done. ${pending.summary} completed successfully.`;

    const assistantMessage = await this.llmChats.insertMessageInternal({
      conversationId: params.conversationId,
      role: 'assistant',
      content: replyText,
      metadata_json: {
        toolsUsed: [pending.tool_key],
        toolErrors: toolError ? [{ toolKey: pending.tool_key, message: toolError }] : [],
        confirmedActionId: pending.id,
        toolResult,
      },
    });

    await this.touchConversation(params.conversationId);

    const remainingCredits = toolCredits ?? (
      'remainingCredits' in chatConsume ? chatConsume.remainingCredits : undefined
    );

    return {
      userMessage,
      assistantMessage,
      creditsRemaining: remainingCredits ?? null,
      toolsUsed: [pending.tool_key],
      toolErrors: toolError ? [{ toolKey: pending.tool_key, message: toolError }] : [],
      pendingAction: null,
    };
  }

  private async rejectPendingAction(params: {
    organizationId: string;
    userId: string;
    conversationId: string;
    actionId: string;
    capabilityKey: string;
  }) {
    const chatConsume = await this.credits.consume({
      organizationId: params.organizationId,
      capabilityKey: params.capabilityKey,
      referenceId: params.conversationId,
    });

    const pending = await this.pendingActions.getPendingForUser({
      actionId: params.actionId,
      organizationId: params.organizationId,
      userId: params.userId,
      conversationId: params.conversationId,
    });

    await this.pendingActions.resolve(pending.id, 'rejected');

    const userMessage = await this.llmChats.insertMessageInternal({
      conversationId: params.conversationId,
      role: 'user',
      content: `Rejected: ${pending.summary}`,
      metadata_json: { pending_action_id: pending.id, action: 'reject' },
    });

    const assistantMessage = await this.llmChats.insertMessageInternal({
      conversationId: params.conversationId,
      role: 'assistant',
      content: `Understood — I cancelled "${pending.summary}".`,
      metadata_json: { rejectedActionId: pending.id },
    });

    await this.touchConversation(params.conversationId);

    const remainingCredits =
      'remainingCredits' in chatConsume ? chatConsume.remainingCredits : undefined;

    return {
      userMessage,
      assistantMessage,
      creditsRemaining: remainingCredits ?? null,
      toolsUsed: [] as string[],
      toolErrors: [] as Array<{ toolKey: string; message: string }>,
      pendingAction: null,
    };
  }

  private async touchConversation(conversationId: string) {
    await this.supabase()
      .from('organization_llm_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  }
}
