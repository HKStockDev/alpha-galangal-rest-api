import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const SNAPSHOT_ROW_LIMIT = 50;

export interface MarketingSnapshotResult {
  skipped: boolean;
  reason?: string;
  releaseId?: string;
  slug?: string;
  rowCount?: number;
}

type ScoreRow = {
  entity_id: string;
  score: number;
  rank: number | null;
  explanation: Record<string, unknown> | null;
};

@Injectable()
export class FormulaMarketingSnapshotService {
  private readonly logger = new Logger(FormulaMarketingSnapshotService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private requireClient(): SupabaseClient {
    if (!this.adminClient) {
      throw new Error('Supabase not configured');
    }
    return this.adminClient;
  }

  private formatSyncDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    } catch {
      return iso.slice(0, 10);
    }
  }

  private slugSuffix(): string {
    return randomBytes(3).toString('hex');
  }

  async createReleaseFromCurrentScores(
    formulaKey: string,
    asOf: string,
  ): Promise<MarketingSnapshotResult> {
    const client = this.requireClient();

    const { data: formula, error: fErr } = await client
      .from('formulas')
      .select('id, key, name, visibility, marketing_slug, marketing_settings')
      .eq('key', formulaKey)
      .maybeSingle();
    if (fErr) {
      throw new Error(fErr.message);
    }
    if (!formula?.id) {
      return { skipped: true, reason: `Formula not found: ${formulaKey}` };
    }
    if (formula.visibility !== 'public') {
      return { skipped: true, reason: 'Formula is not public' };
    }

    const marketingSlug =
      typeof formula.marketing_slug === 'string' && formula.marketing_slug.trim()
        ? formula.marketing_slug.trim().toLowerCase()
        : String(formula.key).toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const { data: currentScores, error: sErr } = await client
      .from('entity_scores_current')
      .select('entity_id, score, rank, explanation')
      .eq('formula_id', formula.id)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(SNAPSHOT_ROW_LIMIT);
    if (sErr) {
      throw new Error(sErr.message);
    }
    const scoreRows = (currentScores ?? []) as ScoreRow[];
    if (scoreRows.length === 0) {
      return { skipped: true, reason: 'No scores in entity_scores_current' };
    }

    const datePart = asOf.slice(0, 10).replace(/-/g, '');
    const slug = `${marketingSlug}-${datePart}-${this.slugSuffix()}`;
    const formattedDate = this.formatSyncDate(asOf);
    const formulaName = String(formula.name || formulaKey);

    const { data: release, error: insErr } = await client
      .from('formula_marketing_releases')
      .insert({
        formula_id: formula.id,
        slug,
        title: `${formulaName} — ${formattedDate} Sync`,
        subtitle: `Automated snapshot after scheduled score sync.`,
        body: `This release captures ranked scores as of **${formattedDate}** following the latest formula sync.`,
        as_of: asOf,
        published_at: asOf,
        is_published: true,
        settings_json: formula.marketing_settings ?? {},
      })
      .select('id, slug')
      .single();
    if (insErr) {
      throw new Error(insErr.message);
    }

    const rows = scoreRows.map((row, index) => ({
      release_id: release.id,
      entity_id: row.entity_id,
      rank: row.rank ?? index + 1,
      score: row.score,
      explanation: row.explanation,
    }));

    const { error: rowErr } = await client.from('formula_marketing_release_rows').insert(rows);
    if (rowErr) {
      await client.from('formula_marketing_releases').delete().eq('id', release.id);
      throw new Error(rowErr.message);
    }

    this.logger.log(
      `Created marketing release ${slug} for ${formulaKey} with ${rows.length} ticker rows`,
    );

    return {
      skipped: false,
      releaseId: String(release.id),
      slug: String(release.slug),
      rowCount: rows.length,
    };
  }
}
