import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TestLogService } from '../common/test-log.service';
import {
  AssistantToolExecutorService,
  ToolExecutionContext,
} from './assistant-tool-executor.service';
import { AssistantPendingActionService } from './assistant-pending-action.service';
import { AssistantToolPolicyService } from './assistant-tool-policy.service';
import { AssistantToolRegistryService } from './assistant-tool-registry.service';
import {
  DEFAULT_MESSAGE_HISTORY_LIMIT,
  MAX_TOOL_ITERATIONS,
  MVP_ACTION_TOOL_KEYS,
} from './assistant.constants';

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};

type HistoryMessage = { role: string; content: string };
type ToolErrorInfo = { toolKey: string; message: string };

export type PendingActionPayload = {
  id: string;
  toolKey: string;
  capabilityKey: string;
  summary: string;
  expiresAt: string;
};

const ACTION_TOOL_KEY_SET = new Set<string>(MVP_ACTION_TOOL_KEYS);

@Injectable()
export class AssistantRuntimeService {
  private readonly logger = new Logger(AssistantRuntimeService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly toolRegistry: AssistantToolRegistryService,
    private readonly toolExecutor: AssistantToolExecutorService,
    private readonly toolPolicy: AssistantToolPolicyService,
    private readonly pendingActions: AssistantPendingActionService,
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

  private getGeminiApiKey(): string | undefined {
    return (
      this.config.get<string>('gemini.apiKey') ??
      this.config.get<string>('GEMINI_API_KEY') ??
      process.env.GEMINI_API_KEY
    );
  }

  private resolveProvider(configProvider: string | undefined): 'gemini' | 'openai' {
    const env = this.config.get<string>('ASSISTANT_LLM_PROVIDER')?.toLowerCase();
    if (env === 'openai' || env === 'gemini') return env;
    if (this.getGeminiApiKey()) return 'gemini';
    return configProvider === 'openai' ? 'openai' : 'gemini';
  }

  async loadPromptBundle(conversation: {
    organization_client_id: string | null;
  }): Promise<{ systemText: string; taskText: string }> {
    const keys = [
      'system_prompt_core',
      'system_prompt_safety',
      'system_prompt_style',
      'system_prompt_tools',
      conversation.organization_client_id
        ? 'prompt_template_client_chat'
        : 'prompt_template_global_chat',
    ];

    const { data, error } = await this.supabase()
      .from('ai_prompt_templates')
      .select('template_key, template_text')
      .in('template_key', keys)
      .eq('is_active', true);

    if (error) {
      throw new BadRequestException(error.message);
    }

    const map = new Map(
      (data ?? []).map((r: { template_key: string; template_text: string }) => [
        r.template_key,
        r.template_text,
      ]),
    );

    const systemParts = [
      'system_prompt_core',
      'system_prompt_safety',
      'system_prompt_style',
      'system_prompt_tools',
    ]
      .map((k) => map.get(k))
      .filter(Boolean);

    const taskKey = conversation.organization_client_id
      ? 'prompt_template_client_chat'
      : 'prompt_template_global_chat';
    return {
      systemText: systemParts.join('\n\n'),
      taskText: map.get(taskKey) ?? '',
    };
  }

  async loadCoreConfig(): Promise<{
    model_name: string;
    model_provider: string;
    temperature: number;
    max_output_tokens: number;
  }> {
    const { data, error } = await this.supabase()
      .from('assistant_core_config')
      .select('model_name, model_provider, temperature, max_output_tokens')
      .eq('config_key', 'default')
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      return {
        model_name: 'gemini-2.5-flash',
        model_provider: 'gemini',
        temperature: 0.2,
        max_output_tokens: 1200,
      };
    }
    return data as {
      model_name: string;
      model_provider: string;
      temperature: number;
      max_output_tokens: number;
    };
  }

  async runTurn(params: {
    userMessage: string;
    history: HistoryMessage[];
    ctx: ToolExecutionContext;
    contextJson: Record<string, unknown>;
    conversationId: string;
  }): Promise<{
    reply: string;
    toolsUsed: string[];
    model: string;
    latencyMs: number;
    toolErrors: ToolErrorInfo[];
    pendingAction?: PendingActionPayload;
  }> {
    this.testLog.log('AssistantRuntimeService.runTurn', 'input', {
      conversationId: params.conversationId,
      userMessage: params.userMessage,
      history: params.history,
      organizationId: params.ctx.organizationId,
      userId: params.ctx.userId,
      organizationClientId: params.ctx.organizationClientId,
    });

    const provider = this.resolveProvider(undefined);
    if (provider !== 'gemini') {
      throw new ServiceUnavailableException('Only Gemini assistant provider is supported in MVP');
    }

    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY is not configured for the assistant.',
      );
    }

    const core = await this.loadCoreConfig();
    const tools = await this.toolRegistry.loadMvpTools();
    const functionDeclarations = tools.map((t) => ({
      name: this.toolRegistry.toolKeyToGeminiName(t.tool_key),
      description: `${t.display_name}: ${t.description}`,
      parameters: t.input_schema_json,
    }));

    const modelRaw = core.model_name ?? 'gemini-2.5-flash';
    const modelId = modelRaw.startsWith('models/') ? modelRaw : `models/${modelRaw}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;

    const started = Date.now();
    const toolsUsed: string[] = [];
    const toolErrors: ToolErrorInfo[] = [];

    const systemInstruction = {
      parts: [
        {
          text: `${params.contextJson.systemText ?? ''}\n\nContext:\n${JSON.stringify(params.contextJson, null, 2)}`,
        },
      ],
    };

    const contents: Array<{ role: string; parts: GeminiPart[] }> = [];

    for (const msg of params.history.slice(-DEFAULT_MESSAGE_HISTORY_LIMIT)) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: msg.content }] });
    }
    contents.push({ role: 'user', parts: [{ text: params.userMessage }] });

    let iterations = 0;
    let lastText = '';

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations += 1;
      const body: Record<string, unknown> = {
        systemInstruction,
        contents,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: {
          temperature: Number(core.temperature) ?? 0.2,
          maxOutputTokens: core.max_output_tokens ?? 1200,
        },
      };

      this.testLog.log('AssistantRuntimeService.runTurn', 'ai_request', {
        conversationId: params.conversationId,
        iteration: iterations,
        model: modelRaw,
        systemInstruction,
        contents,
        generationConfig: body.generationConfig,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          Number(this.config.get<string>('ASSISTANT_TURN_TIMEOUT_MS') ?? 45_000),
        ),
      });

      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }

      if (!res.ok) {
        const err = data?.error as { message?: string } | undefined;
        this.testLog.log('AssistantRuntimeService.runTurn', 'ai_response_error', {
          conversationId: params.conversationId,
          iteration: iterations,
          status: res.status,
          error: err?.message ?? `Gemini API error: ${res.status}`,
        });
        throw new InternalServerErrorException(
          err?.message ?? `Gemini API error: ${res.status}`,
        );
      }

      const candidates = data?.candidates as
        | Array<{ content?: { parts?: GeminiPart[] } }>
        | undefined;
      const parts = candidates?.[0]?.content?.parts ?? [];
      const functionCalls = parts.filter((p) => p.functionCall?.name);
      const textParts = parts
        .map((p) => p.text ?? '')
        .join('')
        .trim();

      this.testLog.log('AssistantRuntimeService.runTurn', 'ai_response', {
        conversationId: params.conversationId,
        iteration: iterations,
        text: textParts,
        functionCalls: functionCalls.map((p) => ({
          name: p.functionCall?.name,
          args: p.functionCall?.args,
        })),
      });

      if (functionCalls.length === 0) {
        lastText = textParts || 'I could not generate a response.';
        break;
      }

      contents.push({ role: 'model', parts });

      const responseParts: GeminiPart[] = [];
      for (const part of functionCalls) {
        const fc = part.functionCall!;
        const toolKey = this.toolRegistry.geminiNameToToolKey(fc.name);
        const toolArgs = (fc.args ?? {}) as Record<string, unknown>;
        const toolMeta = tools.find((t) => t.tool_key === toolKey);
        toolsUsed.push(toolKey);

        if (this.toolExecutor.isMutatingTool(toolKey) && toolMeta) {
          try {
            const { needsConfirmation } = await this.toolPolicy.assertToolAllowed({
              organizationId: params.ctx.organizationId,
              capabilityKey: toolMeta.capability_key,
              organizationClientId: params.ctx.organizationClientId,
            });
            if (needsConfirmation) {
              const pending = await this.pendingActions.create({
                organizationId: params.ctx.organizationId,
                conversationId: params.conversationId,
                userId: params.ctx.userId,
                toolKey,
                capabilityKey: toolMeta.capability_key,
                args: toolArgs,
              });
              const pendingResult = {
                reply: `I need your confirmation before I ${pending.summary}. Use the confirm button below to proceed, or reject to cancel.`,
                toolsUsed: [...new Set(toolsUsed)],
                model: modelRaw,
                latencyMs: Date.now() - started,
                toolErrors,
                pendingAction: {
                  id: pending.id,
                  toolKey,
                  capabilityKey: toolMeta.capability_key,
                  summary: pending.summary,
                  expiresAt: pending.expires_at,
                },
              };
              this.testLog.log('AssistantRuntimeService.runTurn', 'output', {
                conversationId: params.conversationId,
                ...pendingResult,
              });
              return pendingResult;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Tool policy check failed';
            toolErrors.push({ toolKey, message: msg });
            responseParts.push({
              functionResponse: {
                name: fc.name,
                response: { result: { error: msg } },
              },
            });
            continue;
          }
        }

        let toolResult: unknown;
        try {
          if (
            (ACTION_TOOL_KEY_SET.has(toolKey) || this.toolExecutor.isMutatingTool(toolKey)) &&
            toolMeta
          ) {
            await this.toolPolicy.assertToolAllowed({
              organizationId: params.ctx.organizationId,
              capabilityKey: toolMeta.capability_key,
              organizationClientId: params.ctx.organizationClientId,
            });
            await this.toolPolicy.consumeToolCredits({
              organizationId: params.ctx.organizationId,
              capabilityKey: toolMeta.capability_key,
              referenceId: params.conversationId,
            });
          }
          toolResult = await this.toolExecutor.execute(toolKey, toolArgs, params.ctx);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Tool execution failed';
          this.logger.error(`Tool ${toolKey} failed: ${msg}`);
          toolErrors.push({ toolKey, message: msg });
          toolResult = {
            error: msg,
          };
        }
        this.testLog.log('AssistantRuntimeService.runTurn', 'tool_result', {
          conversationId: params.conversationId,
          toolKey,
          args: toolArgs,
          result: toolResult,
        });
        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: { result: toolResult } as Record<string, unknown>,
          },
        });
      }
      contents.push({ role: 'user', parts: responseParts });

      if (textParts) {
        lastText = textParts;
      }
    }

    if (!lastText) {
      lastText =
        'I reached the maximum number of tool steps. Please try a simpler question.';
    }

    const turnResult = {
      reply: lastText,
      toolsUsed: [...new Set(toolsUsed)],
      model: modelRaw,
      latencyMs: Date.now() - started,
      toolErrors,
    };

    this.testLog.log('AssistantRuntimeService.runTurn', 'output', {
      conversationId: params.conversationId,
      ...turnResult,
    });

    return turnResult;
  }
}
