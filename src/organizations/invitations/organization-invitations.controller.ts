import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../auth/guards/supabase-auth.guard';
import { OrgAdminGuard } from '../guards/org-admin.guard';
import { OrganizationInvitationsService } from './organization-invitations.service';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  ResendInvitationDto,
} from './dto';

@Controller('organizations/:organizationId/invitations')
@UseGuards(SupabaseAuthGuard, OrgAdminGuard)
export class OrganizationInvitationsController {
  constructor(
    private readonly invitationsService: OrganizationInvitationsService,
  ) {}

  @Get()
  async list(
    @Param('organizationId') organizationId: string,
    @Query('status') status?: 'pending' | 'accepted' | 'revoked' | 'expired',
  ) {
    return this.invitationsService.list(organizationId, status);
  }

  @Post()
  async create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string; email: string },
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.create(organizationId, user.id, dto);
  }

  @Post(':invitationId/cancel')
  async cancel(
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
  ) {
    await this.invitationsService.cancel(organizationId, invitationId);
    return { success: true };
  }

  @Post(':invitationId/resend')
  async resend(
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: { id: string; email: string },
    @Body() dto: ResendInvitationDto,
  ) {
    return this.invitationsService.resend(
      organizationId,
      invitationId,
      user.id,
      dto,
    );
  }
}
