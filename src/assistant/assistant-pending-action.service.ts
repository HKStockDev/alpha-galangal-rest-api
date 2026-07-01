import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TestLogService } from '../common/test-log.service';
import { PENDING_ACTION_TTL_MS } from './assistant.constants';

export type PendingActionRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  user_id: string;
  tool_key: string;
  capability_key: string;
  args_json: Record<string, unknown>;
  summary: string;
  status: string;
  expires_at: string;
  created_at: string;
};

@Injectable()
export class AssistantPendingActionService {
  private adminClient: SupabaseClient | null = null;

  constructor(
    private readonly config: ConfigService,
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

  buildSummary(toolKey: string, args: Record<string, unknown>): string {
    switch (toolKey) {
      case 'tool.watchlist.create':
        return `Create watchlist "${String(args.name ?? '')}"`;
      case 'tool.watchlist.add_stocks':
        return `Add ${JSON.stringify(args.tickers ?? [])} to watchlist`;
      case 'tool.watchlist.remove_stocks':
        return `Remove ${JSON.stringify(args.tickers ?? [])} from watchlist`;
      case 'tool.formula.create':
        return `Create formula "${String(args.name ?? '')}"`;
      case 'tool.watchlist.create_from_screen':
        return `Create watchlist "${String(args.name ?? '')}" from screener results`;
      default:
        return `Run ${toolKey}`;
    }
  }

  async create(params: {
    organizationId: string;
    conversationId: string;
    userId: string;
    toolKey: string;
    capabilityKey: string;
    args: Record<string, unknown>;
  }): Promise<PendingActionRow> {
    this.testLog.log('AssistantPendingActionService.create', 'input', params);

    const ttlMs = Number(this.config.get<string>('ASSISTANT_PENDING_ACTION_TTL_MS') ?? PENDING_ACTION_TTL_MS);
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const summary = this.buildSummary(params.toolKey, params.args);

    const { data, error } = await this.supabase()
      .from('organization_llm_pending_actions')
      .insert({
        organization_id: params.organizationId,
        conversation_id: params.conversationId,
        user_id: params.userId,
        tool_key: params.toolKey,
        capability_key: params.capabilityKey,
        args_json: params.args,
        summary,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    this.testLog.log('AssistantPendingActionService.create', 'output', {
      id: data.id,
      toolKey: data.tool_key,
      summary: data.summary,
    });
    return data as PendingActionRow;
  }

  async getPendingForUser(params: {
    actionId: string;
    organizationId: string;
    userId: string;
    conversationId: string;
  }): Promise<PendingActionRow> {
    this.testLog.log('AssistantPendingActionService.getPendingForUser', 'input', params);

    const { data, error } = await this.supabase()
      .from('organization_llm_pending_actions')
      .select('*')
      .eq('id', params.actionId)
      .eq('organization_id', params.organizationId)
      .eq('user_id', params.userId)
      .eq('conversation_id', params.conversationId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Pending action not found');
    }

    const row = data as PendingActionRow;
    if (row.status !== 'pending') {
      throw new BadRequestException(`Action already ${row.status}`);
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.supabase()
        .from('organization_llm_pending_actions')
        .update({ status: 'expired', resolved_at: new Date().toISOString() })
        .eq('id', params.actionId);
      throw new BadRequestException('Pending action expired');
    }
    this.testLog.log('AssistantPendingActionService.getPendingForUser', 'output', {
      id: row.id,
      toolKey: row.tool_key,
      summary: row.summary,
    });
    return row;
  }

  async resolve(actionId: string, status: 'confirmed' | 'rejected'): Promise<void> {
    this.testLog.log('AssistantPendingActionService.resolve', 'input', {
      actionId,
      status,
    });

    const { error } = await this.supabase()
      .from('organization_llm_pending_actions')
      .update({ status, resolved_at: new Date().toISOString() })
      .eq('id', actionId)
      .eq('status', 'pending');

    if (error) {
      throw new BadRequestException(error.message);
    }
  }
}
