import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ApolloOrganizationEnrichmentService } from './apollo-organization-enrichment.service';
import {
  CreateOrganizationDto,
  EnrichOrganizationDto,
  UpdateOrganizationDto,
  UpdateOrganizationMembershipDto,
} from './dto';
import { getRemoveMembershipBlockReason } from './organizations-membership-removal';

const ORGANIZATION_SELECT =
  'id, name, slug, organization_type, status, created_by_user_id, settings_json, created_at, updated_at, ' +
  'legal_name, domain, website_url, linkedin_url, logo_url, phone, description, industry, ' +
  'estimated_num_employees, founded_year, country, region, city, address_line1, postal_code, raw_address, ' +
  'external_provider_id, enriched_at, enrichment_source, enrichment_raw_json';

export interface OrgWithRole {
  id: string;
  name: string;
  slug: string;
  organization_type: string;
  status: string;
  created_at: string;
  role: string;
  membership_status: string;
  logo_url?: string | null;
  domain?: string | null;
  legal_name?: string | null;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  organization_type: string;
  status: string;
  created_by_user_id: string | null;
  settings_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  legal_name?: string | null;
  domain?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  logo_url?: string | null;
  phone?: string | null;
  description?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  founded_year?: number | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  address_line1?: string | null;
  postal_code?: string | null;
  raw_address?: string | null;
  external_provider_id?: string | null;
  enriched_at?: string | null;
  enrichment_source?: string | null;
  enrichment_raw_json?: Record<string, unknown>;
}

export interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  status: string;
  joined_at: string;
  email?: string;
  full_name?: string;
}

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(
    private config: ConfigService,
    private readonly apolloEnrichment: ApolloOrganizationEnrichmentService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private getClient(): SupabaseClient {
    if (!this.adminClient) {
      throw new BadRequestException('Service unavailable');
    }
    return this.adminClient;
  }

  async checkSlugAvailability(slug: string): Promise<{ available: boolean; valid_format: boolean }> {
    const client = this.getClient();
    const normalized = slug.trim().toLowerCase();
    const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!normalized || !slugPattern.test(normalized)) {
      return { available: false, valid_format: false };
    }
    const { data: existing } = await client
      .from('organizations')
      .select('id')
      .eq('slug', normalized)
      .maybeSingle();
    return { available: !existing, valid_format: true };
  }

  async listMyOrganizations(userId: string): Promise<OrgWithRole[]> {
    const client = this.getClient();
    const { data: memberships, error: memErr } = await client
      .from('organization_memberships')
      .select('organization_id, role, status')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (memErr || !memberships?.length) {
      return [];
    }

    const orgIds = memberships.map((m) => m.organization_id);
    const { data: orgs, error: orgErr } = await client
      .from('organizations')
      .select('id, name, slug, organization_type, status, created_at, logo_url, domain, legal_name')
      .in('id', orgIds);

    if (orgErr || !orgs?.length) {
      return [];
    }

    const memMap = new Map(
      memberships.map((m) => [m.organization_id, { role: m.role, status: m.status }]),
    );

    return orgs.map((o) => ({
      ...o,
      role: memMap.get(o.id)?.role ?? 'org_member',
      membership_status: memMap.get(o.id)?.status ?? 'active',
    }));
  }

  async getOne(organizationId: string, userId: string): Promise<OrganizationRow> {
    const client = this.getClient();
    const { data: mem } = await client
      .from('organization_memberships')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (!mem) {
      throw new ForbiddenException('Organization membership required');
    }

    const { data: org, error } = await client
      .from('organizations')
      .select(ORGANIZATION_SELECT)
      .eq('id', organizationId)
      .single();

    if (error || !org) {
      throw new NotFoundException('Organization not found');
    }

    return org as unknown as OrganizationRow;
  }

  async enrichFromApollo(
    organizationId: string,
    dto: EnrichOrganizationDto,
  ): Promise<OrganizationRow> {
    const client = this.getClient();
    const { data: row, error: fetchErr } = await client
      .from('organizations')
      .select('id, domain')
      .eq('id', organizationId)
      .maybeSingle();

    if (fetchErr || !row) {
      throw new NotFoundException('Organization not found');
    }

    const domainSource = dto.domain ?? row.domain;
    if (!domainSource?.trim()) {
      throw new BadRequestException(
        'Set organization domain first, or pass domain in the request body',
      );
    }

    const normalized = this.apolloEnrichment.normalizeDomain(domainSource);
    const { organization, raw } =
      await this.apolloEnrichment.fetchOrganizationByDomain(normalized);
    const patch = this.apolloEnrichment.mapApolloOrganizationToPatch(organization, raw);

    const { data: updated, error } = await client
      .from('organizations')
      .update(patch)
      .eq('id', organizationId)
      .select(ORGANIZATION_SELECT)
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!updated) {
      throw new NotFoundException('Organization not found');
    }

    return updated as unknown as OrganizationRow;
  }

  async create(userId: string, dto: CreateOrganizationDto): Promise<OrganizationRow> {
    const client = this.getClient();
    const slug = dto.slug.trim().toLowerCase();

    const { data: existing } = await client
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existing) {
      throw new ConflictException('An organization with this slug already exists');
    }

    const domainNorm = dto.enrichment_domain
      ? this.apolloEnrichment.normalizeDomain(dto.enrichment_domain)
      : undefined;

    const { data: org, error } = await client
      .from('organizations')
      .insert({
        name: dto.name.trim(),
        slug,
        organization_type: dto.organization_type,
        status: 'active',
        created_by_user_id: userId,
        settings_json: dto.settings_json ?? {},
        ...(domainNorm ? { domain: domainNorm } : {}),
      })
      .select(ORGANIZATION_SELECT)
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!org) {
      throw new BadRequestException('Insert failed');
    }

    const created = org as unknown as OrganizationRow;

    const { error: memErr } = await client.from('organization_memberships').insert({
      organization_id: created.id,
      user_id: userId,
      role: 'org_admin',
      status: 'active',
      invited_by_user_id: userId,
    });

    if (memErr) {
      throw new BadRequestException('Failed to create membership');
    }

    if (domainNorm) {
      try {
        return await this.enrichFromApollo(created.id, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Post-create enrichment failed for org ${created.id}: ${msg}`);
      }
    }

    return created;
  }

  async update(
    organizationId: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationRow> {
    const client = this.getClient();

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.slug !== undefined) updates.slug = dto.slug.trim().toLowerCase();
    if (dto.organization_type !== undefined) updates.organization_type = dto.organization_type;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.settings_json !== undefined) updates.settings_json = dto.settings_json;
    if (dto.domain !== undefined) {
      updates.domain = this.apolloEnrichment.normalizeDomain(dto.domain);
    }

    if (Object.keys(updates).length === 0) {
      const { data } = await client
        .from('organizations')
        .select(ORGANIZATION_SELECT)
        .eq('id', organizationId)
        .single();
      if (!data) throw new NotFoundException('Organization not found');
      return data as unknown as OrganizationRow;
    }

    if (updates.slug) {
      const { data: existing } = await client
        .from('organizations')
        .select('id')
        .eq('slug', updates.slug)
        .neq('id', organizationId)
        .maybeSingle();
      if (existing) {
        throw new ConflictException('An organization with this slug already exists');
      }
    }

    const { data: org, error } = await client
      .from('organizations')
      .update(updates)
      .eq('id', organizationId)
      .select(ORGANIZATION_SELECT)
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!org) throw new NotFoundException('Organization not found');

    return org as unknown as OrganizationRow;
  }

  async listMemberships(organizationId: string, userId: string): Promise<MembershipRow[]> {
    const client = this.getClient();
    const { data: mem } = await client
      .from('organization_memberships')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (!mem) {
      throw new ForbiddenException('Organization membership required');
    }

    const { data: rows, error } = await client
      .from('organization_memberships')
      .select('id, organization_id, user_id, role, status, joined_at')
      .eq('organization_id', organizationId)
      .order('joined_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    const userIds = [...new Set((rows ?? []).map((r) => r.user_id))];
    const { data: profiles } = await client
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.id, { email: p.email, full_name: p.full_name }]),
    );

    return (rows ?? []).map((r) => ({
      ...r,
      email: profileMap.get(r.user_id)?.email,
      full_name: profileMap.get(r.user_id)?.full_name,
    })) as MembershipRow[];
  }

  async updateMembership(
    organizationId: string,
    membershipId: string,
    dto: UpdateOrganizationMembershipDto,
    actingUserId?: string,
  ): Promise<MembershipRow> {
    const client = this.getClient();

    const { data: existing } = await client
      .from('organization_memberships')
      .select('id, user_id, role, status')
      .eq('id', membershipId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundException('Membership not found');
    }

    if (dto.status === 'disabled' && existing.status !== 'disabled' && actingUserId) {
      const blockReason = await this.getRemoveMembershipBlockReason(
        organizationId,
        existing,
        actingUserId,
      );
      if (blockReason) {
        throw new BadRequestException(blockReason);
      }
    }

    const updates: Record<string, unknown> = {};
    if (dto.role !== undefined) updates.role = dto.role;
    if (dto.status !== undefined) updates.status = dto.status;

    const disabling = dto.status === 'disabled' && existing.status !== 'disabled';

    if (Object.keys(updates).length === 0) {
      const { data } = await client
        .from('organization_memberships')
        .select('id, organization_id, user_id, role, status, joined_at')
        .eq('id', membershipId)
        .single();
      const profile = await client.from('profiles').select('email, full_name').eq('id', existing.user_id).single();
      return {
        ...data,
        email: profile.data?.email,
        full_name: profile.data?.full_name,
      } as MembershipRow;
    }

    const { data: updated, error } = await client
      .from('organization_memberships')
      .update(updates)
      .eq('id', membershipId)
      .eq('organization_id', organizationId)
      .select('id, organization_id, user_id, role, status, joined_at')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!updated) throw new NotFoundException('Membership not found');

    if (disabling) {
      await this.syncSeatsAfterMemberRemoved(organizationId, membershipId);
    }

    const profile = await client.from('profiles').select('email, full_name').eq('id', updated.user_id).single();
    return {
      ...updated,
      email: profile.data?.email,
      full_name: profile.data?.full_name,
    } as MembershipRow;
  }

  /** CON-101: disable member and decrease per-seat subscription quantity when applicable. */
  async removeMembership(
    organizationId: string,
    membershipId: string,
    actingUserId: string,
  ): Promise<{ success: boolean; seat_quantity_updated?: boolean }> {
    const client = this.getClient();

    const { data: existing } = await client
      .from('organization_memberships')
      .select('id, user_id, role, status')
      .eq('id', membershipId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundException('Membership not found');
    }

    const blockReason = await this.getRemoveMembershipBlockReason(
      organizationId,
      existing,
      actingUserId,
    );
    if (blockReason) {
      throw new BadRequestException(blockReason);
    }

    if (existing.status === 'disabled') {
      return { success: true, seat_quantity_updated: false };
    }

    const { error } = await client
      .from('organization_memberships')
      .update({ status: 'disabled' })
      .eq('id', membershipId)
      .eq('organization_id', organizationId);

    if (error) throw new BadRequestException(error.message);

    const seatSync = await this.syncSeatsAfterMemberRemoved(organizationId, membershipId);
    return { success: true, seat_quantity_updated: seatSync.updated };
  }

  private async getRemoveMembershipBlockReason(
    organizationId: string,
    target: { user_id: string; role: string; status: string },
    actingUserId: string,
  ): Promise<string | null> {
    const client = this.getClient();
    let otherActiveAdminCount = 0;
    if (target.role === 'org_admin' && target.status === 'active') {
      const { count, error } = await client
        .from('organization_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('role', 'org_admin')
        .eq('status', 'active')
        .neq('user_id', target.user_id);
      if (error) {
        throw new BadRequestException(error.message);
      }
      otherActiveAdminCount = count ?? 0;
    }

    return getRemoveMembershipBlockReason({
      actingUserId,
      targetUserId: target.user_id,
      targetStatus: target.status,
      targetRole: target.role,
      otherActiveAdminCount,
    });
  }

  /** Disables membership revert + seat sync; used by CON-101 remove and status=disabled PATCH. */
  private async syncSeatsAfterMemberRemoved(
    organizationId: string,
    membershipId: string,
  ): Promise<{ updated: boolean }> {
    const client = this.getClient();
    try {
      return await this.billingService.syncSubscriptionSeatsToMemberCount(organizationId);
    } catch (err) {
      const { error: revertErr } = await client
        .from('organization_memberships')
        .update({ status: 'active' })
        .eq('id', membershipId)
        .eq('organization_id', organizationId);

      if (revertErr) {
        this.logger.error(
          `Failed to revert membership ${membershipId} after seat sync error: ${revertErr.message}`,
        );
      }

      const message =
        err instanceof Error ? err.message : 'Failed to update subscription seats';
      throw new BadRequestException(message);
    }
  }
}
