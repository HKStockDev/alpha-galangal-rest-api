import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { BillingService } from '../../billing/billing.service';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { InvitationEmailService } from './invitation-email.service';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  ResendInvitationDto,
} from './dto';

export interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  invited_by_user_id: string | null;
  accepted_by_user_id: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvitationWithDetails extends InvitationRow {
  organization_name?: string;
  inviter_name?: string;
  invite_url?: string;
}

export interface InvitationByTokenResponse {
  organizationName: string;
  inviterName: string;
  role: string;
  email: string;
  expiresAt: string | null;
}

@Injectable()
export class OrganizationInvitationsService {
  private adminClient: SupabaseClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly emailService: InvitationEmailService,
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
      throw new Error('Supabase client not configured');
    }
    return this.adminClient;
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  async list(
    organizationId: string,
    status?: 'pending' | 'accepted' | 'revoked' | 'expired',
  ): Promise<InvitationWithDetails[]> {
    const client = this.getClient();
    let q = client
      .from('organization_invitations')
      .select(
        'id, organization_id, email, role, status, token, invited_by_user_id, accepted_by_user_id, expires_at, accepted_at, created_at, updated_at',
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (status) {
      q = q.eq('status', status);
    }

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as InvitationRow[];
    const orgRes = await client
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single();
    const orgName = orgRes.data?.name ?? 'Organization';

    const inviterIds = [...new Set(rows.map((r) => r.invited_by_user_id).filter(Boolean))] as string[];
    const inviterMap: Record<string, string> = {};
    if (inviterIds.length > 0) {
      const { data: profiles } = await client
        .from('profiles')
        .select('id, full_name, email')
        .in('id', inviterIds);
      for (const p of profiles ?? []) {
        inviterMap[p.id] = p.full_name || p.email || 'Unknown';
      }
    }

    return rows.map((r) => ({
      ...r,
      organization_name: orgName,
      inviter_name: r.invited_by_user_id ? inviterMap[r.invited_by_user_id] ?? 'Unknown' : 'Unknown',
      invite_url: this.emailService.buildInviteUrl(r.token),
    }));
  }

  async create(
    organizationId: string,
    userId: string,
    dto: CreateInvitationDto,
  ): Promise<InvitationWithDetails> {
    const client = this.getClient();
    const email = dto.email.trim().toLowerCase();

    const { data: existing } = await client
      .from('organization_invitations')
      .select('id, status')
      .eq('organization_id', organizationId)
      .ilike('email', email)
      .maybeSingle();

    if (existing?.status === 'pending') {
      throw new ConflictException(
        `A pending invitation already exists for ${dto.email}`,
      );
    }

    await this.billingService.assertCanInviteTeamMember(organizationId);

    const token = this.generateToken();
    const expiresInDays = dto.expiresInDays ?? 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const { data: org } = await client
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single();

    const { data: inviter } = await client
      .from('profiles')
      .select('full_name, email')
      .eq('id', userId)
      .single();

    const { data: inserted, error } = await client
      .from('organization_invitations')
      .insert({
        organization_id: organizationId,
        email,
        role: dto.role,
        status: 'pending',
        token,
        invited_by_user_id: userId,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!inserted) throw new BadRequestException('Insert failed');

    const inviteUrl = this.emailService.buildInviteUrl(token);
    await this.emailService.sendInviteEmail({
      to: email,
      organizationName: org?.name ?? 'Organization',
      inviterName: inviter?.full_name || inviter?.email || 'A team member',
      role: dto.role,
      inviteUrl,
      expiresAt,
    });

    return {
      ...inserted,
      organization_name: org?.name,
      inviter_name: inviter?.full_name || inviter?.email || 'Unknown',
      invite_url: inviteUrl,
    };
  }

  async cancel(organizationId: string, invitationId: string): Promise<void> {
    const client = this.getClient();
    const { data, error } = await client
      .from('organization_invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId)
      .eq('organization_id', organizationId)
      .in('status', ['pending'])
      .select('id')
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) {
      throw new NotFoundException(
        'Invitation not found or already cancelled/accepted',
      );
    }
  }

  async resend(
    organizationId: string,
    invitationId: string,
    userId: string,
    dto: ResendInvitationDto,
  ): Promise<InvitationWithDetails> {
    const client = this.getClient();
    const { data: inv } = await client
      .from('organization_invitations')
      .select('*')
      .eq('id', invitationId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!inv) {
      throw new NotFoundException('Invitation not found');
    }

    if (!['pending', 'revoked', 'expired'].includes(inv.status)) {
      throw new BadRequestException(
        'Can only resend pending, revoked, or expired invitations',
      );
    }

    const token = this.generateToken();
    const expiresInDays = dto.expiresInDays ?? 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const { data: org } = await client
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single();

    const { data: inviter } = await client
      .from('profiles')
      .select('full_name, email')
      .eq('id', userId)
      .single();

    const { data: updated, error } = await client
      .from('organization_invitations')
      .update({
        status: 'pending',
        token,
        expires_at: expiresAt.toISOString(),
        accepted_at: null,
        accepted_by_user_id: null,
      })
      .eq('id', invitationId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!updated) throw new BadRequestException('Update failed');

    const inviteUrl = this.emailService.buildInviteUrl(token);
    await this.emailService.sendInviteEmail({
      to: inv.email,
      organizationName: org?.name ?? 'Organization',
      inviterName: inviter?.full_name || inviter?.email || 'A team member',
      role: inv.role,
      inviteUrl,
      expiresAt,
    });

    return {
      ...updated,
      organization_name: org?.name,
      inviter_name: inviter?.full_name || inviter?.email || 'Unknown',
      invite_url: inviteUrl,
    };
  }

  async getByToken(token: string): Promise<InvitationByTokenResponse | null> {
    const client = this.getClient();
    const { data: inv, error } = await client
      .from('organization_invitations')
      .select('email, role, status, expires_at, organization_id, invited_by_user_id')
      .eq('token', token)
      .maybeSingle();

    if (error || !inv) return null;
    if (inv.status !== 'pending') return null;
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return null;

    const [orgRes, profileRes] = await Promise.all([
      client.from('organizations').select('name').eq('id', inv.organization_id).single(),
      inv.invited_by_user_id
        ? client.from('profiles').select('full_name, email').eq('id', inv.invited_by_user_id).single()
        : Promise.resolve({ data: null }),
    ]);

    return {
      organizationName: orgRes.data?.name ?? 'Organization',
      inviterName: profileRes.data?.full_name || profileRes.data?.email || 'A team member',
      role: inv.role,
      email: inv.email,
      expiresAt: inv.expires_at,
    };
  }

  async accept(userId: string, userEmail: string, dto: AcceptInvitationDto): Promise<{ invitation: InvitationRow; membership: { id: string } }> {
    const client = this.getClient();
    const token = dto.token.trim();

    const { data: inv, error: invErr } = await client
      .from('organization_invitations')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (invErr || !inv) {
      throw new BadRequestException('Invalid or expired invitation');
    }

    if (inv.status !== 'pending') {
      throw new BadRequestException('Invitation has already been used or cancelled');
    }

    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    const inviteEmail = (inv.email ?? '').trim().toLowerCase();
    const authEmail = (userEmail ?? '').trim().toLowerCase();
    if (inviteEmail !== authEmail) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
    }

    const { data: existingMembership } = await client
      .from('organization_memberships')
      .select('id')
      .eq('organization_id', inv.organization_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingMembership) {
      await client
        .from('organization_invitations')
        .update({
          status: 'accepted',
          accepted_by_user_id: userId,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', inv.id);
      return {
        invitation: inv,
        membership: { id: existingMembership.id },
      };
    }

    const { data: membership, error: memErr } = await client
      .from('organization_memberships')
      .insert({
        organization_id: inv.organization_id,
        user_id: userId,
        role: inv.role,
        status: 'active',
        invited_by_user_id: inv.invited_by_user_id,
      })
      .select('id')
      .single();

    if (memErr || !membership) {
      throw new BadRequestException('Failed to create membership');
    }

    const { error: updateErr } = await client
      .from('organization_invitations')
      .update({
        status: 'accepted',
        accepted_by_user_id: userId,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', inv.id);

    if (updateErr) {
      throw new BadRequestException('Failed to update invitation');
    }

    try {
      await this.billingService.syncSubscriptionSeatsToMemberCount(inv.organization_id);
    } catch (err) {
      await client
        .from('organization_memberships')
        .delete()
        .eq('id', membership.id);
      await client
        .from('organization_invitations')
        .update({
          status: 'pending',
          accepted_by_user_id: null,
          accepted_at: null,
        })
        .eq('id', inv.id);

      const message =
        err instanceof Error ? err.message : 'Failed to update subscription seats';
      throw new BadRequestException(message);
    }

    return { invitation: inv, membership: { id: membership.id } };
  }
}
