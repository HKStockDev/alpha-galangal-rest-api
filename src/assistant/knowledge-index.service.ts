import { createHash } from 'crypto';
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EmbeddingService, formatPgVector } from './embedding.service';

export const KNOWLEDGE_SOURCE_TYPES = [
  'client_entity_risk_notes',
  'formula_release_body',
  'chat_message',
] as const;

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

type SourceChunk = {
  organization_id: string;
  organization_client_id: string | null;
  source_type: KnowledgeSourceType;
  source_id: string;
  title: string | null;
  content: string;
  content_hash: string;
  source_updated_at: string;
};

@Injectable()
export class KnowledgeIndexService {
  private readonly logger = new Logger(KnowledgeIndexService.name);
  private adminClient: SupabaseClient | null = null;
  private readonly hasServiceRoleKey: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly embedding: EmbeddingService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    this.hasServiceRoleKey = !!serviceRoleKey;
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private supabase(): SupabaseClient {
    if (!this.adminClient) {
      throw new BadRequestException('Service unavailable');
    }
    if (!this.hasServiceRoleKey) {
      throw new ServiceUnavailableException(
        'Knowledge indexing requires SUPABASE_SERVICE_ROLE_KEY (anon key cannot access knowledge index).',
      );
    }
    return this.adminClient;
  }

  private isEnabled(): boolean {
    return this.config.get<boolean>('assistant.knowledgeIndexEnabled') ?? true;
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private isPlaceholderEchoContent(content: string): boolean {
    return /placeholder marketing copy|sample content|use the admin panel to replace|seed data for admin|no substantive release copy discussing/i.test(
      content,
    );
  }

  private buildClientEntityContent(row: {
    display_name: string;
    risk_notes: string | null;
    notes: string | null;
  }): string | null {
    const parts = [
      row.risk_notes?.trim(),
      row.notes?.trim(),
    ].filter(Boolean) as string[];
    if (parts.length === 0) return null;
    return `Client entity: ${row.display_name}\n${parts.join('\n\n')}`;
  }

  async syncOrganization(params: {
    organizationId: string;
    organizationClientId: string | null;
  }): Promise<{ indexed: number; skipped: number }> {
    if (!this.isEnabled()) {
      return { indexed: 0, skipped: 0 };
    }

    const sources = await this.collectSources(params);
    if (sources.length === 0) {
      return { indexed: 0, skipped: 0 };
    }

    const sb = this.supabase();
    const sourceKeys = sources.map((s) => ({
      source_type: s.source_type,
      source_id: s.source_id,
    }));

    const { data: existingRows, error: existingErr } = await sb
      .from('organization_knowledge_chunks')
      .select('source_type, source_id, content_hash')
      .eq('organization_id', params.organizationId)
      .in(
        'source_type',
        KNOWLEDGE_SOURCE_TYPES as unknown as string[],
      );

    if (existingErr) {
      throw new BadRequestException(existingErr.message);
    }

    const existingMap = new Map<string, string>();
    for (const row of existingRows ?? []) {
      existingMap.set(
        `${row.source_type}:${row.source_id}`,
        row.content_hash as string,
      );
    }

    const staleKeys = new Set(
      [...existingMap.keys()].filter((key) => {
        const [sourceType, sourceId] = key.split(':');
        return !sourceKeys.some(
          (s) => s.source_type === sourceType && s.source_id === sourceId,
        );
      }),
    );

    if (staleKeys.size > 0) {
      for (const key of staleKeys) {
        const [sourceType, sourceId] = key.split(':');
        const { error } = await sb
          .from('organization_knowledge_chunks')
          .delete()
          .eq('organization_id', params.organizationId)
          .eq('source_type', sourceType)
          .eq('source_id', sourceId);
        if (error) {
          this.logger.warn(`Failed to delete stale chunk ${key}: ${error.message}`);
        }
      }
    }

    const toEmbed = sources.filter((source) => {
      const key = `${source.source_type}:${source.source_id}`;
      return existingMap.get(key) !== source.content_hash;
    });

    for (const source of toEmbed) {
      const { error } = await sb
        .from('organization_knowledge_chunks')
        .delete()
        .eq('organization_id', params.organizationId)
        .eq('source_type', source.source_type)
        .eq('source_id', source.source_id)
        .neq('content_hash', source.content_hash);

      if (error) {
        this.logger.warn(
          `Failed to delete stale knowledge chunk ${source.source_type}:${source.source_id}: ${error.message}`,
        );
      }
    }

    let indexed = 0;
    let skipped = sources.length - toEmbed.length;

    const batchSize = this.config.get<number>('assistant.knowledgeEmbedBatch') ?? 16;
    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const vectors = await this.embedding.embedTexts(batch.map((b) => b.content));
      const now = new Date().toISOString();

      const upsertRows = batch.map((source, index) => ({
        organization_id: source.organization_id,
        organization_client_id: source.organization_client_id,
        source_type: source.source_type,
        source_id: source.source_id,
        title: source.title,
        content: source.content,
        content_hash: source.content_hash,
        embedding: formatPgVector(vectors[index]),
        embedded_at: now,
        source_updated_at: source.source_updated_at,
      }));

      const { error } = await sb
        .from('organization_knowledge_chunks')
        .upsert(upsertRows, { onConflict: 'source_type,source_id,content_hash' });

      if (error) {
        throw new BadRequestException(error.message);
      }
      indexed += batch.length;
    }

    return { indexed, skipped };
  }

  private async collectSources(params: {
    organizationId: string;
    organizationClientId: string | null;
  }): Promise<SourceChunk[]> {
    const [clientEntityChunks, releaseChunks, chatChunks] = await Promise.all([
      this.collectClientEntitySources(params),
      this.collectReleaseSources(params),
      this.collectChatSources(params),
    ]);
    return [...clientEntityChunks, ...releaseChunks, ...chatChunks];
  }

  private async collectClientEntitySources(params: {
    organizationId: string;
    organizationClientId: string | null;
  }): Promise<SourceChunk[]> {
    const sb = this.supabase();
    let clientQuery = sb
      .from('organization_clients')
      .select('id')
      .eq('organization_id', params.organizationId);

    if (params.organizationClientId) {
      clientQuery = clientQuery.eq('id', params.organizationClientId);
    }

    const { data: clients, error: clientErr } = await clientQuery.limit(500);
    if (clientErr) {
      throw new BadRequestException(clientErr.message);
    }

    const clientIds = (clients ?? []).map((c) => c.id as string);
    if (clientIds.length === 0) return [];

    const { data, error } = await sb
      .from('client_entities')
      .select('id, display_name, risk_notes, notes, updated_at, client_id')
      .in('client_id', clientIds)
      .limit(500);

    if (error) {
      throw new BadRequestException(error.message);
    }

    const chunks: SourceChunk[] = [];
    for (const row of data ?? []) {
      const content = this.buildClientEntityContent({
        display_name: row.display_name as string,
        risk_notes: row.risk_notes as string | null,
        notes: row.notes as string | null,
      });
      if (!content) continue;

      chunks.push({
        organization_id: params.organizationId,
        organization_client_id: row.client_id as string,
        source_type: 'client_entity_risk_notes',
        source_id: row.id as string,
        title: row.display_name as string,
        content,
        content_hash: this.hashContent(content),
        source_updated_at: (row.updated_at as string) ?? new Date().toISOString(),
      });
    }
    return chunks;
  }

  private async collectReleaseSources(params: {
    organizationId: string;
  }): Promise<SourceChunk[]> {
    const sb = this.supabase();
    const { data: formulas, error: formulaErr } = await sb
      .from('formulas')
      .select('id, name')
      .or(`organization_id.eq.${params.organizationId},visibility.eq.public`);

    if (formulaErr) {
      throw new BadRequestException(formulaErr.message);
    }

    const formulaIds = (formulas ?? []).map((f) => f.id as string);
    if (formulaIds.length === 0) return [];

    const formulaNameById = new Map(
      (formulas ?? []).map((f) => [f.id as string, f.name as string]),
    );

    const { data, error } = await sb
      .from('formula_marketing_releases')
      .select('id, formula_id, title, subtitle, body, updated_at')
      .in('formula_id', formulaIds)
      .eq('is_published', true)
      .not('body', 'is', null)
      .limit(200);

    if (error) {
      throw new BadRequestException(error.message);
    }

    const chunks: SourceChunk[] = [];
    for (const row of data ?? []) {
      const body = (row.body as string | null)?.trim();
      if (!body || body.length < 20 || this.isPlaceholderEchoContent(body)) continue;

      const titleParts = [
        formulaNameById.get(row.formula_id as string),
        row.title as string,
        row.subtitle as string | null,
      ].filter(Boolean);

      const content = titleParts.length
        ? `${titleParts.join(' — ')}\n\n${body}`
        : body;

      chunks.push({
        organization_id: params.organizationId,
        organization_client_id: null,
        source_type: 'formula_release_body',
        source_id: row.id as string,
        title: (row.title as string) ?? null,
        content,
        content_hash: this.hashContent(content),
        source_updated_at: (row.updated_at as string) ?? new Date().toISOString(),
      });
    }
    return chunks;
  }

  private async collectChatSources(params: {
    organizationId: string;
    organizationClientId: string | null;
  }): Promise<SourceChunk[]> {
    const sb = this.supabase();
    let convQuery = sb
      .from('organization_llm_conversations')
      .select('id, organization_client_id')
      .eq('organization_id', params.organizationId);

    if (params.organizationClientId) {
      convQuery = convQuery.or(
        `organization_client_id.is.null,organization_client_id.eq.${params.organizationClientId}`,
      );
    }

    const { data: conversations, error: convErr } = await convQuery.limit(200);
    if (convErr) {
      throw new BadRequestException(convErr.message);
    }

    const conversationIds = (conversations ?? []).map((c) => c.id as string);
    if (conversationIds.length === 0) return [];

    const clientByConversation = new Map(
      (conversations ?? []).map((c) => [c.id as string, c.organization_client_id as string | null]),
    );

    const { data: messages, error: msgErr } = await sb
      .from('organization_llm_messages')
      .select('id, conversation_id, role, content, created_at')
      .in('conversation_id', conversationIds)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(300);

    if (msgErr) {
      throw new BadRequestException(msgErr.message);
    }

    const chunks: SourceChunk[] = [];
    for (const row of messages ?? []) {
      const content = (row.content as string)?.trim();
      if (!content || content.length < 20 || this.isPlaceholderEchoContent(content)) continue;

      const conversationId = row.conversation_id as string;
      chunks.push({
        organization_id: params.organizationId,
        organization_client_id: clientByConversation.get(conversationId) ?? null,
        source_type: 'chat_message',
        source_id: row.id as string,
        title: `${row.role as string} message`,
        content,
        content_hash: this.hashContent(content),
        source_updated_at: (row.created_at as string) ?? new Date().toISOString(),
      });
    }
    return chunks;
  }
}
