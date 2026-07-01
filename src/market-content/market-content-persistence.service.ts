import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { MarketContentClassifierOutput } from './market-content-classifier.contract';
import { ContentCategoriesService } from './content-categories.service';

function jsonSafeFmpArticle(article: Record<string, unknown>): Record<string, unknown> {
  return {
    provider: 'fmp',
    symbol: article.symbol ?? null,
    publishedDate: article.publishedDate ?? null,
    title: article.title ?? null,
    text: article.text ?? null,
    description: article.description ?? null,
    url: article.url ?? null,
    site: article.site ?? null,
  };
}

function toTimestamptzOrNull(iso: string | null): string | null {
  if (!iso || !iso.trim()) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

@Injectable()
export class MarketContentPersistenceService {
  private adminClient: SupabaseClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly contentCategoriesService: ContentCategoriesService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private requireClient(): SupabaseClient {
    if (!this.adminClient) {
      throw new ServiceUnavailableException('Supabase is not configured.');
    }
    return this.adminClient;
  }

  private async resolveEntityId(client: SupabaseClient, identifier: string): Promise<string> {
    const key = identifier.trim().toUpperCase();
    if (!key) {
      throw new BadRequestException('entity_identifier is empty.');
    }
    const { data, error } = await client.from('entities').select('id').eq('key', key).maybeSingle();
    if (error) {
      throw new InternalServerErrorException(`entities lookup failed: ${error.message}`);
    }
    if (!data?.id) {
      throw new BadRequestException(
        `No entity row for key="${key}". Sync the ticker into public.entities (e.g. FMP sync) before persisting.`,
      );
    }
    return data.id;
  }

  /**
   * Inserts `market_content` + `market_content_entities` from validated classifier output.
   * When `source` + `url` are both non-empty, replaces any existing row with the same pair (delete + insert).
   */
  async persistClassifierOutput(
    validated: MarketContentClassifierOutput,
    fmpArticle: Record<string, unknown>,
  ): Promise<{ market_content_id: string; replaced_existing: boolean }> {
    const client = this.requireClient();
    const mc = validated.market_content;
    const source = mc.source.trim();
    const contentType = mc.content_type.trim();
    const urlNorm = (mc.url ?? '').trim() || null;
    await this.contentCategoriesService.assertCategoryAllowed(mc.category);

    const entityRows: Array<{
      entity_id: string;
      is_primary: boolean;
      polarity: number | null;
      severity: number | null;
      confidence: number | null;
      should_display: boolean;
      display_reason: string | null;
      materiality_score: number | null;
    }> = [];

    for (const row of validated.market_content_entities) {
      const entity_id = await this.resolveEntityId(client, row.entity_identifier);
      entityRows.push({
        entity_id,
        is_primary: row.is_primary,
        polarity: row.polarity,
        severity: row.severity,
        confidence: row.confidence,
        should_display: row.should_display,
        display_reason: row.display_reason,
        materiality_score: row.materiality_score,
      });
    }

    let replaced_existing = false;
    if (urlNorm) {
      const { data: existing, error: findErr } = await client
        .from('market_content')
        .select('id')
        .eq('source', source)
        .eq('url', urlNorm)
        .maybeSingle();
      if (findErr) {
        throw new InternalServerErrorException(`market_content dedupe lookup failed: ${findErr.message}`);
      }
      if (existing?.id) {
        const { error: delErr } = await client.from('market_content').delete().eq('id', existing.id);
        if (delErr) {
          throw new InternalServerErrorException(`market_content delete (dedupe) failed: ${delErr.message}`);
        }
        replaced_existing = true;
      }
    }

    const insertRow = {
      source,
      content_type: contentType,
      category: mc.category,
      title: mc.title,
      summary: mc.summary,
      url: urlNorm,
      published_at: toTimestamptzOrNull(mc.published_at),
      occurred_at: toTimestamptzOrNull(mc.occurred_at),
      raw: jsonSafeFmpArticle(fmpArticle),
    };

    const { data: inserted, error: insErr } = await client
      .from('market_content')
      .insert(insertRow)
      .select('id')
      .single();

    if (insErr || !inserted?.id) {
      throw new InternalServerErrorException(
        insErr?.message ?? 'market_content insert failed with no returned id',
      );
    }

    const market_content_id = inserted.id as string;
    const childPayload = entityRows.map((r) => ({
      market_content_id,
      ...r,
    }));

    const { error: childErr } = await client.from('market_content_entities').insert(childPayload);
    if (childErr) {
      await client.from('market_content').delete().eq('id', market_content_id);
      throw new InternalServerErrorException(`market_content_entities insert failed: ${childErr.message}`);
    }

    return { market_content_id, replaced_existing };
  }
}
