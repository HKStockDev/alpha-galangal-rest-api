import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  rankAssignmentRows,
  toPublicExposureHub,
  toPublicTagHub,
  toPublicTaxonomyLibraryItem,
  type PublicTaxonomyHub,
  type PublicTaxonomyLibraryItem,
  type TaxonomyAssignmentRowLike,
} from './taxonomy-marketing-public.helpers';

const DEFAULT_ORG_SLUG = 'default-organization';

const EXPOSURE_SELECT =
  'exposure_id, name, slug, category, description, polarity, visibility, marketing_slug, hero_image_url, marketing_settings, is_active';

const TAG_SELECT =
  'tag_id, name, slug, group, description, visibility, marketing_slug, hero_image_url, marketing_settings, is_active, organization_id';

type SecurityJoin = {
  ticker: string | null;
  name: string | null;
};

@Injectable()
export class TaxonomyMarketingService {
  private adminClient: SupabaseClient | null = null;
  private defaultOrganizationId: string | null = null;

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
      throw new ServiceUnavailableException('Supabase is not configured.');
    }
    return this.adminClient;
  }

  private async resolveDefaultOrganizationId(): Promise<string | null> {
    if (this.defaultOrganizationId) {
      return this.defaultOrganizationId;
    }
    const client = this.requireClient();
    const { data, error } = await client
      .from('organizations')
      .select('id')
      .eq('slug', DEFAULT_ORG_SLUG)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data?.id) {
      return null;
    }
    this.defaultOrganizationId = data.id;
    return data.id;
  }

  private findByMarketingSlug<T extends { marketing_slug?: string | null }>(
    rows: T[],
    slug: string,
  ): T | undefined {
    return rows.find(
      (row) =>
        typeof row.marketing_slug === 'string' &&
        row.marketing_slug.trim().toLowerCase() === slug,
    );
  }

  private mapSecurityJoin(sec: SecurityJoin | SecurityJoin[] | null | undefined): SecurityJoin {
    if (Array.isArray(sec)) {
      return sec[0] ?? { ticker: null, name: null };
    }
    return sec ?? { ticker: null, name: null };
  }

  async listPublicExposures(): Promise<PublicTaxonomyLibraryItem[]> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('exposures')
      .select(EXPOSURE_SELECT)
      .eq('visibility', 'public')
      .eq('is_active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) {
      throw new BadRequestException(error.message);
    }

    const exposures = (data ?? []) as Array<Record<string, unknown>>;
    const counts = await this.countExposureAssignments(
      client,
      exposures.map((e) => String(e.exposure_id)),
    );

    return exposures
      .filter((e) => typeof e.marketing_slug === 'string' && e.marketing_slug.trim() !== '')
      .map((e) => {
        const marketingSlug = String(e.marketing_slug).trim().toLowerCase();
        return toPublicTaxonomyLibraryItem({
          row: e,
          marketingSlug,
          securityCount: counts.get(String(e.exposure_id)) ?? 0,
          kind: 'exposure',
        });
      });
  }

  async getExposureHubBySlug(marketingSlug: string): Promise<PublicTaxonomyHub> {
    const client = this.requireClient();
    const slug = marketingSlug.trim().toLowerCase();
    if (!slug) {
      throw new NotFoundException('Exposure hub not found');
    }

    const { data, error } = await client
      .from('exposures')
      .select(EXPOSURE_SELECT)
      .eq('visibility', 'public')
      .eq('is_active', true)
      .ilike('marketing_slug', slug);
    if (error) {
      throw new BadRequestException(error.message);
    }

    const exposure = this.findByMarketingSlug(
      (data ?? []) as Array<{ marketing_slug?: string | null }>,
      slug,
    ) as Record<string, unknown> | undefined;
    if (!exposure) {
      throw new NotFoundException('Exposure hub not found');
    }

    const { assignments, asOfDate } = await this.loadExposureAssignments(
      client,
      String(exposure.exposure_id),
    );

    return toPublicExposureHub({
      exposure,
      marketingSlug: slug,
      asOfDate,
      assignments,
    });
  }

  async listPublicTags(): Promise<PublicTaxonomyLibraryItem[]> {
    const client = this.requireClient();
    const defaultOrgId = await this.resolveDefaultOrganizationId();
    if (!defaultOrgId) {
      return [];
    }

    const { data, error } = await client
      .from('tags')
      .select(TAG_SELECT)
      .eq('visibility', 'public')
      .eq('is_active', true)
      .eq('organization_id', defaultOrgId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) {
      throw new BadRequestException(error.message);
    }

    const tags = (data ?? []) as Array<Record<string, unknown>>;
    const counts = await this.countTagAssignments(
      client,
      tags.map((t) => String(t.tag_id)),
    );

    return tags
      .filter((t) => typeof t.marketing_slug === 'string' && t.marketing_slug.trim() !== '')
      .map((t) => {
        const marketingSlug = String(t.marketing_slug).trim().toLowerCase();
        return toPublicTaxonomyLibraryItem({
          row: t,
          marketingSlug,
          securityCount: counts.get(String(t.tag_id)) ?? 0,
          kind: 'tag',
        });
      });
  }

  async getTagHubBySlug(marketingSlug: string): Promise<PublicTaxonomyHub> {
    const client = this.requireClient();
    const slug = marketingSlug.trim().toLowerCase();
    if (!slug) {
      throw new NotFoundException('Tag hub not found');
    }

    const defaultOrgId = await this.resolveDefaultOrganizationId();
    if (!defaultOrgId) {
      throw new NotFoundException('Tag hub not found');
    }

    const { data, error } = await client
      .from('tags')
      .select(TAG_SELECT)
      .eq('visibility', 'public')
      .eq('is_active', true)
      .eq('organization_id', defaultOrgId)
      .ilike('marketing_slug', slug);
    if (error) {
      throw new BadRequestException(error.message);
    }

    const tag = this.findByMarketingSlug(
      (data ?? []) as Array<{ marketing_slug?: string | null }>,
      slug,
    ) as Record<string, unknown> | undefined;
    if (!tag) {
      throw new NotFoundException('Tag hub not found');
    }

    const { assignments, asOfDate } = await this.loadTagAssignments(
      client,
      String(tag.tag_id),
    );

    return toPublicTagHub({
      tag,
      marketingSlug: slug,
      asOfDate,
      assignments,
    });
  }

  private async countExposureAssignments(
    client: SupabaseClient,
    exposureIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (exposureIds.length === 0) return counts;

    const { data, error } = await client
      .from('security_exposures')
      .select('exposure_id, as_of_date')
      .in('exposure_id', exposureIds);
    if (error) {
      throw new BadRequestException(error.message);
    }

    const latestByExposure = new Map<string, string>();
    for (const row of data ?? []) {
      const exposureId = String((row as { exposure_id: string }).exposure_id);
      const asOf = String((row as { as_of_date: string }).as_of_date);
      const prev = latestByExposure.get(exposureId);
      if (!prev || asOf > prev) {
        latestByExposure.set(exposureId, asOf);
      }
    }

    const tally = new Map<string, number>();
    for (const row of data ?? []) {
      const exposureId = String((row as { exposure_id: string }).exposure_id);
      const asOf = String((row as { as_of_date: string }).as_of_date);
      if (latestByExposure.get(exposureId) !== asOf) continue;
      tally.set(exposureId, (tally.get(exposureId) ?? 0) + 1);
    }
    return tally;
  }

  private async countTagAssignments(
    client: SupabaseClient,
    tagIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (tagIds.length === 0) return counts;

    const { data, error } = await client
      .from('security_tags')
      .select('tag_id, as_of_date')
      .in('tag_id', tagIds);
    if (error) {
      throw new BadRequestException(error.message);
    }

    const latestByTag = new Map<string, string>();
    for (const row of data ?? []) {
      const tagId = String((row as { tag_id: string }).tag_id);
      const asOf = String((row as { as_of_date: string }).as_of_date);
      const prev = latestByTag.get(tagId);
      if (!prev || asOf > prev) {
        latestByTag.set(tagId, asOf);
      }
    }

    const tally = new Map<string, number>();
    for (const row of data ?? []) {
      const tagId = String((row as { tag_id: string }).tag_id);
      const asOf = String((row as { as_of_date: string }).as_of_date);
      if (latestByTag.get(tagId) !== asOf) continue;
      tally.set(tagId, (tally.get(tagId) ?? 0) + 1);
    }
    return tally;
  }

  private async loadExposureAssignments(
    client: SupabaseClient,
    exposureId: string,
  ): Promise<{ assignments: TaxonomyAssignmentRowLike[]; asOfDate: string | null }> {
    const { data: latestRows, error: latestErr } = await client
      .from('security_exposures')
      .select('as_of_date')
      .eq('exposure_id', exposureId)
      .order('as_of_date', { ascending: false })
      .limit(1);
    if (latestErr) {
      throw new BadRequestException(latestErr.message);
    }
    const asOfDate =
      latestRows?.[0]?.as_of_date != null ? String(latestRows[0].as_of_date) : null;
    if (!asOfDate) {
      return { assignments: [], asOfDate: null };
    }

    const { data, error } = await client
      .from('security_exposures')
      .select('strength, securities(ticker, name)')
      .eq('exposure_id', exposureId)
      .eq('as_of_date', asOfDate);
    if (error) {
      throw new BadRequestException(error.message);
    }

    const raw = (data ?? []).map((row) => {
      const sec = this.mapSecurityJoin(
        (row as { securities: SecurityJoin | SecurityJoin[] | null }).securities,
      );
      const strength = Number((row as { strength: number }).strength);
      return {
        score: Number.isFinite(strength) ? strength : 0,
        ticker: sec.ticker,
        entity_name: sec.name,
      };
    });

    const ranked = rankAssignmentRows(raw);
    const assignments: TaxonomyAssignmentRowLike[] = ranked.map((r) => ({
      rank: r.rank,
      score: r.score,
      ticker: r.ticker,
      entity_name: r.entity_name,
    }));

    return { assignments, asOfDate };
  }

  private async loadTagAssignments(
    client: SupabaseClient,
    tagId: string,
  ): Promise<{ assignments: TaxonomyAssignmentRowLike[]; asOfDate: string | null }> {
    const { data: latestRows, error: latestErr } = await client
      .from('security_tags')
      .select('as_of_date')
      .eq('tag_id', tagId)
      .order('as_of_date', { ascending: false })
      .limit(1);
    if (latestErr) {
      throw new BadRequestException(latestErr.message);
    }
    const asOfDate =
      latestRows?.[0]?.as_of_date != null ? String(latestRows[0].as_of_date) : null;
    if (!asOfDate) {
      return { assignments: [], asOfDate: null };
    }

    const { data, error } = await client
      .from('security_tags')
      .select('confidence, securities(ticker, name)')
      .eq('tag_id', tagId)
      .eq('as_of_date', asOfDate);
    if (error) {
      throw new BadRequestException(error.message);
    }

    const raw = (data ?? []).map((row) => {
      const sec = this.mapSecurityJoin(
        (row as { securities: SecurityJoin | SecurityJoin[] | null }).securities,
      );
      const confidence = Number((row as { confidence: number }).confidence);
      return {
        score: Number.isFinite(confidence) ? confidence : 0,
        ticker: sec.ticker,
        entity_name: sec.name,
      };
    });

    const ranked = rankAssignmentRows(raw);
    const assignments: TaxonomyAssignmentRowLike[] = ranked.map((r) => ({
      rank: r.rank,
      score: r.score,
      ticker: r.ticker,
      entity_name: r.entity_name,
    }));

    return { assignments, asOfDate };
  }
}
