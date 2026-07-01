import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { DataSyncLastRun } from '../data-sync/data-sync.types';
import { formatScheduleSummary } from '../data-sync/schedule-evaluator';
import {
  SCORE_SYNC_JOB_BY_FORMULA_KEY,
} from '../formula-score-sync/formula-score-sync.registry';
import { loadDataSyncJobLastRuns } from '../sync/data-sync-run-store';
import { loadDataSyncJobSchedule } from '../sync/data-sync-schedules.store';
import { TRIGGER_SYNC_CRON_DEFAULTS, TRIGGER_SYNC_TASK_IDS } from '../trigger/trigger-task-ids';
import { stripLinearTicketRefs } from '../common/strip-linear-ticket-refs';
import {
  CreateFormulaMarketingReleaseDto,
  ReplaceReleaseRowsDto,
  UpdateFormulaMarketingDto,
  UpdateFormulaMarketingReleaseDto,
} from './dto';
import {
  pickCurrentPublishedReleaseId,
  toPublicMarketingHub,
  toPublicReleasePage,
  type PublicMarketingHub,
  type PublicMarketingReleasePage,
} from './formula-marketing-public.helpers';

const FORMULA_MARKETING_SELECT =
  'id, organization_id, key, name, visibility, hero_image_url, marketing_slug, marketing_settings, description, display_formula, next_release_at, seo_title, seo_description, seo_og_image_url, updated_at';

const RELEASE_SELECT =
  'id, formula_id, slug, title, subtitle, body, hero_image_url, as_of, published_at, is_published, settings_json, seo_title, seo_description, seo_og_image_url, created_by_user_id, updated_by_user_id, created_at, updated_at';

const ROW_SELECT = 'id, release_id, entity_id, rank, score, explanation, created_at';

const FORMULA_HERO_BUCKET = 'formula-heroes';
const FORMULA_OG_BUCKET = 'formula-og';
const MARKETING_IMAGE_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const MARKETING_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export interface FormulaMarketingRow {
  id: string;
  /** Null for legacy / platform-wide rows. */
  organization_id: string | null;
  key: string;
  name: string;
  visibility: string;
  hero_image_url: string | null;
  marketing_slug: string | null;
  marketing_settings: Record<string, unknown>;
  description: string;
  display_formula: string;
  next_release_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_og_image_url: string | null;
  updated_at: string;
}

export interface ReleaseRow {
  id: string;
  release_id: string;
  entity_id: string;
  rank: number | null;
  score: number;
  explanation: Record<string, unknown> | null;
  created_at: string;
  /** Ticker for table display: `securities.ticker` when linked, else `entities.key` for stocks. */
  ticker: string | null;
  /** Display name: prefers linked security name, else entity name. */
  entity_name: string | null;
  entities?: {
    key: string;
    name: string | null;
    entity_type?: string | null;
    securities?: { ticker: string | null; name: string | null } | null;
  } | null;
}

@Injectable()
export class FormulaMarketingService {
  private readonly logger = new Logger(FormulaMarketingService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private sanitizeFormulaMarketingRow(row: FormulaMarketingRow): FormulaMarketingRow {
    return {
      ...row,
      description: stripLinearTicketRefs(row.description) ?? '',
      seo_title: stripLinearTicketRefs(row.seo_title),
      seo_description: stripLinearTicketRefs(row.seo_description),
    };
  }

  private sanitizeReleaseRecord<T extends Record<string, unknown>>(release: T): T {
    return {
      ...release,
      subtitle: stripLinearTicketRefs(
        release.subtitle != null ? String(release.subtitle) : null,
      ),
      body: stripLinearTicketRefs(release.body != null ? String(release.body) : null),
      seo_title: stripLinearTicketRefs(
        release.seo_title != null ? String(release.seo_title) : null,
      ),
      seo_description: stripLinearTicketRefs(
        release.seo_description != null ? String(release.seo_description) : null,
      ),
    };
  }

  private requireClient(): SupabaseClient {
    if (!this.adminClient) {
      throw new ServiceUnavailableException('Supabase is not configured.');
    }
    return this.adminClient;
  }

  private requireServiceRoleForStorage(): SupabaseClient {
    const url = this.config.getOrThrow<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    if (!serviceRoleKey) {
      throw new ServiceUnavailableException(
        'SUPABASE_SERVICE_ROLE_KEY is required to upload or remove formula marketing storage assets.',
      );
    }
    return createClient(url, serviceRoleKey);
  }

  private formulaHeroObjectPath(formulaId: string): string {
    return `${formulaId}/hero`;
  }

  /** `formula-og` bucket: one OG asset per formula hub page. */
  private formulaSeoOgObjectPath(formulaId: string): string {
    return `formulas/${formulaId}/og`;
  }

  /** `formula-og` bucket: one OG asset per marketing release page. */
  private releaseSeoOgObjectPath(releaseId: string): string {
    return `releases/${releaseId}/og`;
  }

  private assertMarketingImageFile(file: Express.Multer.File): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    if (file.size > MARKETING_IMAGE_MAX_BYTES) {
      throw new BadRequestException('Image must be 2MB or smaller');
    }
    if (!MARKETING_IMAGE_ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Use a JPEG, PNG, WebP, or GIF image');
    }
  }

  async uploadFormulaHeroImage(
    formulaId: string,
    file: Express.Multer.File,
  ): Promise<FormulaMarketingRow> {
    this.assertMarketingImageFile(file);
    await this.getFormula(formulaId);

    const admin = this.requireServiceRoleForStorage();
    const objectPath = this.formulaHeroObjectPath(formulaId);
    const { error: upErr } = await admin.storage
      .from(FORMULA_HERO_BUCKET)
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (upErr) {
      this.logger.warn(`formula hero upload storage: ${upErr.message}`);
      throw new BadRequestException('Could not store image');
    }

    const { data: pub } = admin.storage.from(FORMULA_HERO_BUCKET).getPublicUrl(objectPath);
    const base = pub.publicUrl;
    const sep = base.includes('?') ? '&' : '?';
    const publicUrl = `${base}${sep}t=${Date.now()}`;

    const client = this.requireClient();
    const { data, error } = await client
      .from('formulas')
      .update({ hero_image_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', formulaId)
      .select(FORMULA_MARKETING_SELECT)
      .single();
    if (error) {
      this.logger.warn(`formula hero update row: ${error.message}`);
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Formula not found');
    }
    return this.sanitizeFormulaMarketingRow(data as unknown as FormulaMarketingRow);
  }

  async deleteFormulaHeroImage(formulaId: string): Promise<FormulaMarketingRow> {
    await this.getFormula(formulaId);
    const admin = this.requireServiceRoleForStorage();
    const objectPath = this.formulaHeroObjectPath(formulaId);
    const { error: rmErr } = await admin.storage.from(FORMULA_HERO_BUCKET).remove([objectPath]);
    if (rmErr) {
      this.logger.warn(`formula hero remove storage: ${rmErr.message}`);
    }

    const client = this.requireClient();
    const { data, error } = await client
      .from('formulas')
      .update({ hero_image_url: null, updated_at: new Date().toISOString() })
      .eq('id', formulaId)
      .select(FORMULA_MARKETING_SELECT)
      .single();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Formula not found');
    }
    return this.sanitizeFormulaMarketingRow(data as unknown as FormulaMarketingRow);
  }

  async uploadFormulaSeoOgImage(
    formulaId: string,
    file: Express.Multer.File,
  ): Promise<FormulaMarketingRow> {
    this.assertMarketingImageFile(file);
    await this.getFormula(formulaId);

    const admin = this.requireServiceRoleForStorage();
    const objectPath = this.formulaSeoOgObjectPath(formulaId);
    const { error: upErr } = await admin.storage
      .from(FORMULA_OG_BUCKET)
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (upErr) {
      this.logger.warn(`formula SEO OG upload storage: ${upErr.message}`);
      throw new BadRequestException('Could not store image');
    }

    const { data: pub } = admin.storage.from(FORMULA_OG_BUCKET).getPublicUrl(objectPath);
    const base = pub.publicUrl;
    const sep = base.includes('?') ? '&' : '?';
    const publicUrl = `${base}${sep}t=${Date.now()}`;

    const client = this.requireClient();
    const { data, error } = await client
      .from('formulas')
      .update({ seo_og_image_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', formulaId)
      .select(FORMULA_MARKETING_SELECT)
      .single();
    if (error) {
      this.logger.warn(`formula SEO OG update row: ${error.message}`);
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Formula not found');
    }
    return this.sanitizeFormulaMarketingRow(data as unknown as FormulaMarketingRow);
  }

  async deleteFormulaSeoOgImage(formulaId: string): Promise<FormulaMarketingRow> {
    await this.getFormula(formulaId);
    const admin = this.requireServiceRoleForStorage();
    const objectPath = this.formulaSeoOgObjectPath(formulaId);
    const { error: rmErr } = await admin.storage.from(FORMULA_OG_BUCKET).remove([objectPath]);
    if (rmErr) {
      this.logger.warn(`formula SEO OG remove storage: ${rmErr.message}`);
    }

    const client = this.requireClient();
    const { data, error } = await client
      .from('formulas')
      .update({ seo_og_image_url: null, updated_at: new Date().toISOString() })
      .eq('id', formulaId)
      .select(FORMULA_MARKETING_SELECT)
      .single();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Formula not found');
    }
    return this.sanitizeFormulaMarketingRow(data as unknown as FormulaMarketingRow);
  }

  private async getReleaseForOgUpload(releaseId: string) {
    const client = this.requireClient();
    const { data, error } = await client
      .from('formula_marketing_releases')
      .select('id')
      .eq('id', releaseId)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Release not found');
    }
  }

  async uploadReleaseSeoOgImage(
    releaseId: string,
    file: Express.Multer.File,
  ): Promise<Record<string, unknown>> {
    this.assertMarketingImageFile(file);
    await this.getReleaseForOgUpload(releaseId);

    const admin = this.requireServiceRoleForStorage();
    const objectPath = this.releaseSeoOgObjectPath(releaseId);
    const { error: upErr } = await admin.storage
      .from(FORMULA_OG_BUCKET)
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (upErr) {
      this.logger.warn(`release SEO OG upload storage: ${upErr.message}`);
      throw new BadRequestException('Could not store image');
    }

    const { data: pub } = admin.storage.from(FORMULA_OG_BUCKET).getPublicUrl(objectPath);
    const base = pub.publicUrl;
    const sep = base.includes('?') ? '&' : '?';
    const publicUrl = `${base}${sep}t=${Date.now()}`;

    const client = this.requireClient();
    const { data, error } = await client
      .from('formula_marketing_releases')
      .update({ seo_og_image_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', releaseId)
      .select(RELEASE_SELECT)
      .single();
    if (error) {
      this.logger.warn(`release SEO OG update row: ${error.message}`);
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Release not found');
    }
    return data;
  }

  async deleteReleaseSeoOgImage(releaseId: string): Promise<Record<string, unknown>> {
    await this.getReleaseForOgUpload(releaseId);
    const admin = this.requireServiceRoleForStorage();
    const objectPath = this.releaseSeoOgObjectPath(releaseId);
    const { error: rmErr } = await admin.storage.from(FORMULA_OG_BUCKET).remove([objectPath]);
    if (rmErr) {
      this.logger.warn(`release SEO OG remove storage: ${rmErr.message}`);
    }

    const client = this.requireClient();
    const { data, error } = await client
      .from('formula_marketing_releases')
      .update({ seo_og_image_url: null, updated_at: new Date().toISOString() })
      .eq('id', releaseId)
      .select(RELEASE_SELECT)
      .single();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Release not found');
    }
    return data;
  }

  async listFormulas(organizationId?: string): Promise<FormulaMarketingRow[]> {
    const client = this.requireClient();
    let q = client
      .from('formulas')
      .select(FORMULA_MARKETING_SELECT)
      .order('name', { ascending: true })
      .limit(10000);
    if (organizationId) {
      // Tenant rows for this org plus legacy / platform rows not scoped to an organization.
      q = q.or(
        `organization_id.eq.${organizationId},organization_id.is.null`,
      );
    }
    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data ?? []).map((row) =>
      this.sanitizeFormulaMarketingRow(row as unknown as FormulaMarketingRow),
    );
  }

  async getFormula(formulaId: string): Promise<FormulaMarketingRow> {
    const client = this.requireClient();
    const { data, error } = await client
      .from('formulas')
      .select(FORMULA_MARKETING_SELECT)
      .eq('id', formulaId)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Formula not found');
    }
    return this.sanitizeFormulaMarketingRow(data as unknown as FormulaMarketingRow);
  }

  async updateFormulaMarketing(
    formulaId: string,
    dto: UpdateFormulaMarketingDto,
  ): Promise<FormulaMarketingRow> {
    const client = this.requireClient();
    const updates: Record<string, unknown> = {};
    if (dto.hero_image_url !== undefined) {
      updates.hero_image_url = dto.hero_image_url === null || dto.hero_image_url === '' ? null : dto.hero_image_url;
    }
    if (dto.marketing_slug !== undefined) {
      updates.marketing_slug =
        dto.marketing_slug === null || (typeof dto.marketing_slug === 'string' && !dto.marketing_slug.trim())
          ? null
          : dto.marketing_slug.trim();
    }
    if (dto.marketing_settings !== undefined) {
      updates.marketing_settings = dto.marketing_settings;
    }
    if (dto.visibility !== undefined) {
      updates.visibility = dto.visibility;
    }
    if (dto.next_release_at !== undefined) {
      updates.next_release_at =
        dto.next_release_at === null || dto.next_release_at === ''
          ? null
          : dto.next_release_at;
    }
    if (dto.seo_title !== undefined) {
      updates.seo_title =
        dto.seo_title === null || (typeof dto.seo_title === 'string' && !dto.seo_title.trim()) ? null : dto.seo_title.trim();
    }
    if (dto.seo_description !== undefined) {
      updates.seo_description =
        dto.seo_description === null || (typeof dto.seo_description === 'string' && !dto.seo_description.trim())
          ? null
          : dto.seo_description.trim();
    }
    if (dto.seo_og_image_url !== undefined) {
      updates.seo_og_image_url =
        dto.seo_og_image_url === null || (typeof dto.seo_og_image_url === 'string' && !dto.seo_og_image_url.trim())
          ? null
          : dto.seo_og_image_url.trim();
    }
    if (Object.keys(updates).length === 0) {
      return this.getFormula(formulaId);
    }
    const { data, error } = await client
      .from('formulas')
      .update(updates)
      .eq('id', formulaId)
      .select(FORMULA_MARKETING_SELECT)
      .single();
    if (error) {
      if (error.code === '23505' || error.message.includes('duplicate') || error.message.includes('unique')) {
        throw new ConflictException('marketing_slug must be unique within the organization, or other unique constraint failed');
      }
      if (error.code === '23514' || error.message.includes('check')) {
        throw new BadRequestException(error.message);
      }
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Formula not found');
    }
    return this.sanitizeFormulaMarketingRow(data as unknown as FormulaMarketingRow);
  }

  async listReleases(formulaId?: string) {
    const client = this.requireClient();
    let q = client
      .from('formula_marketing_releases')
      .select(RELEASE_SELECT)
      .order('published_at', { ascending: false, nullsFirst: true });
    if (formulaId) {
      q = q.eq('formula_id', formulaId);
    }
    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(error.message);
    }
    const releases = data ?? [];
    if (releases.length === 0) {
      return [];
    }

    const published = releases.filter(
      (r) => r.is_published && r.published_at != null && String(r.published_at).trim() !== '',
    );
    let currentId: string | null = null;
    if (published.length > 0) {
      const sorted = [...published].sort((a, b) => {
        const at = Date.parse(String(a.published_at));
        const bt = Date.parse(String(b.published_at));
        return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
      });
      currentId = String(sorted[0]!.id);
    }

    const releaseIds = releases.map((r) => String(r.id));
    const { data: rowRefs, error: rowErr } = await client
      .from('formula_marketing_release_rows')
      .select('release_id')
      .in('release_id', releaseIds);
    if (rowErr) {
      throw new BadRequestException(rowErr.message);
    }
    const countByRelease = new Map<string, number>();
    for (const row of rowRefs ?? []) {
      const id = String((row as { release_id: string }).release_id);
      countByRelease.set(id, (countByRelease.get(id) ?? 0) + 1);
    }

    return releases.map((r) =>
      this.sanitizeReleaseRecord({
        ...r,
        is_current: String(r.id) === currentId,
        row_count: countByRelease.get(String(r.id)) ?? 0,
      }),
    );
  }

  async getFormulaSyncHistory(formulaId: string) {
    const formula = await this.getFormula(formulaId);
    const jobKey = SCORE_SYNC_JOB_BY_FORMULA_KEY[formula.key] ?? null;
    const lastRuns = await loadDataSyncJobLastRuns();
    const dbSchedule = jobKey ? await loadDataSyncJobSchedule(jobKey) : null;
    const scheduleSummary = dbSchedule ? formatScheduleSummary(dbSchedule) : null;
    const triggerCron = jobKey ? TRIGGER_SYNC_CRON_DEFAULTS[jobKey] : null;
    const lastRun: DataSyncLastRun | null = jobKey
      ? (lastRuns[jobKey] ?? null)
      : null;
    const releases = await this.listReleases(formulaId);
    return {
      formula,
      sync: {
        jobKey,
        cron: scheduleSummary ?? triggerCron,
        scheduleSummary,
        enabled: dbSchedule?.enabled,
        triggerTaskId: jobKey ? TRIGGER_SYNC_TASK_IDS[jobKey] : null,
        lastRun,
      },
      releases,
    };
  }

  async getReleaseById(releaseId: string, includeEntityKeys = true) {
    const client = this.requireClient();
    const { data: rel, error } = await client
      .from('formula_marketing_releases')
      .select(RELEASE_SELECT)
      .eq('id', releaseId)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!rel) {
      throw new NotFoundException('Release not found');
    }
    const rows = await this.loadRows(client, releaseId, includeEntityKeys);
    return this.sanitizeReleaseRecord({ ...rel, rows });
  }

  private mapReleaseRowFromDb(raw: Record<string, unknown>): ReleaseRow {
    const ent = raw.entities as
      | {
          key?: string;
          name?: string | null;
          entity_type?: string | null;
          securities?: { ticker?: string | null; name?: string | null } | null;
        }
      | null
      | undefined;
    const sec = ent?.securities;
    const ticker =
      (sec?.ticker != null && String(sec.ticker).trim() !== '' ? String(sec.ticker) : null) ??
      (ent?.key != null && String(ent.key).trim() !== '' ? String(ent.key) : null) ??
      null;
    const entity_name =
      (sec?.name != null && String(sec.name).trim() !== '' ? String(sec.name) : null) ??
      (ent?.name != null && String(ent.name).trim() !== '' ? String(ent.name) : null) ??
      null;
    return {
      id: String(raw.id),
      release_id: String(raw.release_id),
      entity_id: String(raw.entity_id),
      rank: raw.rank as number | null,
      score: Number(raw.score),
      explanation: (raw.explanation as Record<string, unknown> | null) ?? null,
      created_at: String(raw.created_at),
      ticker,
      entity_name,
      entities: ent
        ? {
            key: ent.key != null ? String(ent.key) : '',
            name: ent.name != null ? String(ent.name) : null,
            entity_type: ent.entity_type != null ? String(ent.entity_type) : null,
            securities: sec
              ? {
                  ticker: sec.ticker != null ? String(sec.ticker) : null,
                  name: sec.name != null ? String(sec.name) : null,
                }
              : null,
          }
        : null,
    };
  }

  private async loadRows(
    client: SupabaseClient,
    releaseId: string,
    includeEntityKeys: boolean,
  ): Promise<ReleaseRow[]> {
    if (!includeEntityKeys) {
      const { data, error } = await client
        .from('formula_marketing_release_rows')
        .select(ROW_SELECT)
        .eq('release_id', releaseId)
        .order('rank', { ascending: true, nullsFirst: false });
      if (error) {
        throw new BadRequestException(error.message);
      }
      return (data ?? []).map((row) => {
        const r = row as unknown as Record<string, unknown>;
        return {
          id: String(r.id),
          release_id: String(r.release_id),
          entity_id: String(r.entity_id),
          rank: r.rank as number | null,
          score: Number(r.score),
          explanation: (r.explanation as Record<string, unknown> | null) ?? null,
          created_at: String(r.created_at),
          ticker: null,
          entity_name: null,
          entities: null,
        };
      });
    }
    const selectWithSecurity = `${ROW_SELECT}, entities(key, name, entity_type, securities(ticker, name))`;
    const selectEntityOnly = `${ROW_SELECT}, entities(key, name, entity_type)`;
    const first = await client
      .from('formula_marketing_release_rows')
      .select(selectWithSecurity)
      .eq('release_id', releaseId)
      .order('rank', { ascending: true, nullsFirst: false });
    const errMsg = first.error?.message ?? '';
    const noRel =
      first.error != null &&
      (errMsg.includes('schema cache') ||
        errMsg.toLowerCase().includes('relationship') ||
        (first.error as { code?: string }).code === 'PGRST201');
    if (first.error != null && noRel) {
      const second = await client
        .from('formula_marketing_release_rows')
        .select(selectEntityOnly)
        .eq('release_id', releaseId)
        .order('rank', { ascending: true, nullsFirst: false });
      if (second.error) {
        throw new BadRequestException(second.error.message);
      }
      const data = (second.data ?? []) as Record<string, unknown>[];
      return data.map((row) => this.mapReleaseRowFromDb(row));
    }
    if (first.error != null) {
      throw new BadRequestException(first.error.message);
    }
    const data = (first.data ?? []) as Record<string, unknown>[];
    return data.map((row) => this.mapReleaseRowFromDb(row));
  }

  async getReleaseBySlugForPublic(slug: string): Promise<PublicMarketingReleasePage> {
    const client = this.requireClient();
    const { data: rel, error } = await client
      .from('formula_marketing_releases')
      .select(RELEASE_SELECT)
      .eq('slug', slug.trim().toLowerCase())
      .eq('is_published', true)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!rel) {
      throw new NotFoundException('Release not found');
    }
    const { data: fo, error: fErr } = await client
      .from('formulas')
      .select(
        'id, key, name, visibility, description, marketing_slug, marketing_settings',
      )
      .eq('id', rel.formula_id)
      .maybeSingle();
    if (fErr) {
      throw new BadRequestException(fErr.message);
    }
    if (!fo || fo.visibility !== 'public') {
      throw new NotFoundException('Release not found');
    }
    const rows = await this.loadRows(client, rel.id, true);
    return toPublicReleasePage(
      rel as Record<string, unknown>,
      fo as Record<string, unknown>,
      rows,
    );
  }

  async getHubBySlugForPublic(marketingSlug: string): Promise<PublicMarketingHub> {
    const client = this.requireClient();
    const slug = marketingSlug.trim().toLowerCase();
    if (!slug) {
      throw new NotFoundException('Hub not found');
    }

    const { data: formulas, error: fErr } = await client
      .from('formulas')
      .select(FORMULA_MARKETING_SELECT)
      .eq('visibility', 'public')
      .ilike('marketing_slug', slug);
    if (fErr) {
      throw new BadRequestException(fErr.message);
    }
    const formula = (formulas ?? []).find(
      (row) =>
        typeof row.marketing_slug === 'string' &&
        row.marketing_slug.trim().toLowerCase() === slug,
    );
    if (!formula) {
      throw new NotFoundException('Hub not found');
    }

    const { data: releases, error: rErr } = await client
      .from('formula_marketing_releases')
      .select(RELEASE_SELECT)
      .eq('formula_id', formula.id)
      .order('published_at', { ascending: false, nullsFirst: true });
    if (rErr) {
      throw new BadRequestException(rErr.message);
    }

    const releaseList = (releases ?? []) as Array<Record<string, unknown>>;
    const currentId = pickCurrentPublishedReleaseId(
      releaseList.map((r) => ({
        id: String(r.id),
        slug: String(r.slug),
        title: String(r.title ?? ''),
        published_at: r.published_at != null ? String(r.published_at) : null,
        as_of: String(r.as_of),
        is_published: Boolean(r.is_published),
      })),
    );
    const currentRelease =
      currentId != null
        ? (releaseList.find((r) => String(r.id) === currentId) ?? null)
        : null;
    const currentRows =
      currentRelease != null
        ? await this.loadRows(client, String(currentRelease.id), true)
        : [];

    return toPublicMarketingHub({
      formula: formula as Record<string, unknown>,
      marketingSlug: slug,
      releases: releaseList.map((r) => ({
        id: String(r.id),
        slug: String(r.slug),
        title: String(r.title ?? ''),
        published_at: r.published_at != null ? String(r.published_at) : null,
        as_of: String(r.as_of),
        is_published: Boolean(r.is_published),
      })),
      currentRelease,
      currentRows,
    });
  }

  async createRelease(dto: CreateFormulaMarketingReleaseDto, userId: string) {
    const client = this.requireClient();
    const slug = dto.slug.trim().toLowerCase();
    const insert = {
      formula_id: dto.formula_id,
      slug,
      title: dto.title.trim(),
      subtitle: dto.subtitle?.trim() || null,
      body: dto.body ?? null,
      hero_image_url: dto.hero_image_url?.trim() || null,
      as_of: dto.as_of,
      published_at: dto.published_at ?? null,
      is_published: dto.is_published ?? false,
      settings_json: dto.settings_json ?? {},
      seo_title: dto.seo_title?.trim() || null,
      seo_description: dto.seo_description?.trim() || null,
      seo_og_image_url: dto.seo_og_image_url?.trim() || null,
      created_by_user_id: userId,
      updated_by_user_id: userId,
    };
    const { data, error } = await client
      .from('formula_marketing_releases')
      .insert(insert)
      .select(RELEASE_SELECT)
      .single();
    if (error) {
      if (error.code === '23505' || error.message.includes('duplicate')) {
        throw new ConflictException('A release with this slug already exists');
      }
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async updateRelease(releaseId: string, userId: string, dto: UpdateFormulaMarketingReleaseDto) {
    const client = this.requireClient();
    const updates: Record<string, unknown> = { updated_by_user_id: userId };
    if (dto.slug !== undefined) {
      updates.slug = dto.slug.trim().toLowerCase();
    }
    if (dto.title !== undefined) {
      updates.title = dto.title.trim();
    }
    if (dto.subtitle !== undefined) {
      updates.subtitle = dto.subtitle === null || dto.subtitle === '' ? null : dto.subtitle.trim();
    }
    if (dto.body !== undefined) {
      updates.body = dto.body;
    }
    if (dto.hero_image_url !== undefined) {
      updates.hero_image_url = dto.hero_image_url === null || dto.hero_image_url === '' ? null : dto.hero_image_url;
    }
    if (dto.as_of !== undefined) {
      updates.as_of = dto.as_of;
    }
    if (dto.published_at !== undefined) {
      updates.published_at = dto.published_at;
    }
    if (dto.is_published !== undefined) {
      updates.is_published = dto.is_published;
    }
    if (dto.settings_json !== undefined) {
      updates.settings_json = dto.settings_json;
    }
    if (dto.seo_title !== undefined) {
      updates.seo_title =
        dto.seo_title === null || (typeof dto.seo_title === 'string' && !dto.seo_title.trim()) ? null : dto.seo_title.trim();
    }
    if (dto.seo_description !== undefined) {
      updates.seo_description =
        dto.seo_description === null || (typeof dto.seo_description === 'string' && !dto.seo_description.trim())
          ? null
          : dto.seo_description.trim();
    }
    if (dto.seo_og_image_url !== undefined) {
      updates.seo_og_image_url =
        dto.seo_og_image_url === null || (typeof dto.seo_og_image_url === 'string' && !dto.seo_og_image_url.trim())
          ? null
          : dto.seo_og_image_url.trim();
    }
    const { data, error } = await client
      .from('formula_marketing_releases')
      .update(updates)
      .eq('id', releaseId)
      .select(RELEASE_SELECT)
      .single();
    if (error) {
      if (error.code === '23505' || error.message.includes('duplicate')) {
        throw new ConflictException('A release with this slug already exists');
      }
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Release not found');
    }
    return data;
  }

  async deleteRelease(releaseId: string) {
    const client = this.requireClient();
    const { error } = await client.from('formula_marketing_releases').delete().eq('id', releaseId);
    if (error) {
      throw new BadRequestException(error.message);
    }
  }

  async replaceReleaseRows(releaseId: string, dto: ReplaceReleaseRowsDto) {
    const client = this.requireClient();
    const { data: rel, error: relErr } = await client
      .from('formula_marketing_releases')
      .select('id')
      .eq('id', releaseId)
      .maybeSingle();
    if (relErr) {
      throw new BadRequestException(relErr.message);
    }
    if (!rel) {
      throw new NotFoundException('Release not found');
    }
    const { error: delErr } = await client.from('formula_marketing_release_rows').delete().eq('release_id', releaseId);
    if (delErr) {
      throw new BadRequestException(delErr.message);
    }
    if (dto.rows.length === 0) {
      return { replaced: 0 };
    }
    const rows = dto.rows.map((r) => ({
      release_id: releaseId,
      entity_id: r.entity_id,
      rank: r.rank ?? null,
      score: r.score,
      explanation: r.explanation ?? null,
    }));
    const { error: insErr } = await client.from('formula_marketing_release_rows').insert(rows);
    if (insErr) {
      if (insErr.code === '23503' || insErr.message.includes('foreign key')) {
        throw new BadRequestException('One or more entity_id values are invalid, or entity is restricted');
      }
      throw new BadRequestException(insErr.message);
    }
    return { replaced: dto.rows.length };
  }
}
