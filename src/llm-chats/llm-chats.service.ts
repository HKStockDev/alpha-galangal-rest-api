import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CreditsService } from '../credits/credits.service';
import {
  CreateOrganizationLlmConversationDto,
  CreateOrganizationLlmMessageDto,
  ListOrganizationLlmConversationsQueryDto,
  ListOrganizationLlmMessagesQueryDto,
  UpdateOrganizationLlmConversationDto,
  UpdateOrganizationLlmMessageDto,
} from './dto';

@Injectable()
export class LlmChatsService {
  private adminClient: SupabaseClient | null = null;

  constructor(
    private config: ConfigService,
    private readonly creditsService: CreditsService,
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

  private async assertClientInOrg(organizationId: string, clientId: string) {
    const { data, error } = await this.supabase()
      .from('organization_clients')
      .select('id')
      .eq('id', clientId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new BadRequestException('organization_client_id does not belong to this organization');
    }
  }

  async listConversations(
    organizationId: string,
    userId: string,
    query: ListOrganizationLlmConversationsQueryDto,
  ) {
    if (query.global_only === true && query.organization_client_id) {
      throw new BadRequestException(
        'Use either global_only or organization_client_id, not both',
      );
    }

    let q = this.supabase()
      .from('organization_llm_conversations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (query.global_only === true) {
      q = q.is('organization_client_id', null);
    } else if (query.organization_client_id) {
      await this.assertClientInOrg(organizationId, query.organization_client_id);
      q = q.eq('organization_client_id', query.organization_client_id);
    }

    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(error.message);
    }
    return data ?? [];
  }

  async createConversation(
    organizationId: string,
    userId: string,
    dto: CreateOrganizationLlmConversationDto,
  ) {
    const clientId =
      dto.organization_client_id === undefined || dto.organization_client_id === null
        ? null
        : dto.organization_client_id;

    if (clientId) {
      await this.assertClientInOrg(organizationId, clientId);
    }

    const row: Record<string, unknown> = {
      organization_id: organizationId,
      user_id: userId,
      organization_client_id: clientId,
      title: dto.title ?? null,
      model_key: dto.model_key ?? null,
      metadata_json: dto.metadata_json ?? {},
    };

    const { data, error } = await this.supabase()
      .from('organization_llm_conversations')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async getOwnedConversation(
    organizationId: string,
    userId: string,
    conversationId: string,
  ) {
    const { data, error } = await this.supabase()
      .from('organization_llm_conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Conversation not found');
    }
    return data;
  }

  async updateConversation(
    organizationId: string,
    userId: string,
    conversationId: string,
    dto: UpdateOrganizationLlmConversationDto,
  ) {
    await this.getOwnedConversation(organizationId, userId, conversationId);

    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.model_key !== undefined) patch.model_key = dto.model_key;
    if (dto.metadata_json !== undefined) patch.metadata_json = dto.metadata_json;

    if (Object.keys(patch).length === 0) {
      return this.getOwnedConversation(organizationId, userId, conversationId);
    }

    const { data, error } = await this.supabase()
      .from('organization_llm_conversations')
      .update(patch)
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async deleteConversation(
    organizationId: string,
    userId: string,
    conversationId: string,
  ) {
    await this.getOwnedConversation(organizationId, userId, conversationId);

    const { error } = await this.supabase()
      .from('organization_llm_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId);

    if (error) {
      throw new BadRequestException(error.message);
    }
  }

  async listMessages(
    organizationId: string,
    userId: string,
    conversationId: string,
    query: ListOrganizationLlmMessagesQueryDto,
  ) {
    await this.getOwnedConversation(organizationId, userId, conversationId);

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const { data, error } = await this.supabase()
      .from('organization_llm_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data ?? [];
  }

  /**
   * Persists a message without consuming credits (used by assistant-turn).
   */
  async insertMessageInternal(params: {
    conversationId: string;
    role: string;
    content: string;
    metadata_json?: Record<string, unknown>;
  }) {
    const { data, error } = await this.supabase()
      .from('organization_llm_messages')
      .insert({
        conversation_id: params.conversationId,
        role: params.role,
        content: params.content,
        metadata_json: params.metadata_json ?? {},
      })
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async createMessage(
    organizationId: string,
    userId: string,
    conversationId: string,
    dto: CreateOrganizationLlmMessageDto,
  ) {
    const conversation = await this.getOwnedConversation(organizationId, userId, conversationId);

    const capabilityKey =
      conversation.organization_client_id != null ? 'chat.client' : 'chat.global';

    const skipCredit =
      dto.metadata_json &&
      (dto.metadata_json as { skip_credit_consume?: boolean }).skip_credit_consume === true;

    if (dto.role === 'user' && !skipCredit) {
      await this.creditsService.consume({
        organizationId,
        capabilityKey,
        referenceId: conversationId,
      });
    }

    return this.insertMessageInternal({
      conversationId,
      role: dto.role,
      content: dto.content,
      metadata_json: dto.metadata_json ?? {},
    });
  }

  private async getOwnedMessage(
    organizationId: string,
    userId: string,
    conversationId: string,
    messageId: string,
  ) {
    await this.getOwnedConversation(organizationId, userId, conversationId);

    const { data, error } = await this.supabase()
      .from('organization_llm_messages')
      .select('*')
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Message not found');
    }
    return data;
  }

  async updateMessage(
    organizationId: string,
    userId: string,
    conversationId: string,
    messageId: string,
    dto: UpdateOrganizationLlmMessageDto,
  ) {
    await this.getOwnedMessage(organizationId, userId, conversationId, messageId);

    const patch: Record<string, unknown> = {};
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.metadata_json !== undefined) patch.metadata_json = dto.metadata_json;

    if (Object.keys(patch).length === 0) {
      return this.getOwnedMessage(organizationId, userId, conversationId, messageId);
    }

    const { data, error } = await this.supabase()
      .from('organization_llm_messages')
      .update(patch)
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async deleteMessage(
    organizationId: string,
    userId: string,
    conversationId: string,
    messageId: string,
  ) {
    await this.getOwnedMessage(organizationId, userId, conversationId, messageId);

    const { error } = await this.supabase()
      .from('organization_llm_messages')
      .delete()
      .eq('id', messageId)
      .eq('conversation_id', conversationId);

    if (error) {
      throw new BadRequestException(error.message);
    }
  }
}
