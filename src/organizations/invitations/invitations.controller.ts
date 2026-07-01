import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../auth/guards/supabase-auth.guard';
import { OrganizationInvitationsService } from './organization-invitations.service';
import { AcceptInvitationDto } from './dto';

@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitationsService: OrganizationInvitationsService,
  ) {}

  @Get('by-token/:token')
  async getByToken(@Param('token') token: string) {
    const result = await this.invitationsService.getByToken(token);
    if (!result) {
      return { valid: false, error: 'Invalid or expired invitation' };
    }
    return { valid: true, ...result };
  }

  @Post('accept')
  @UseGuards(SupabaseAuthGuard)
  async accept(
    @CurrentUser() user: { id: string; email: string },
    @Body() dto: AcceptInvitationDto,
  ) {
    return this.invitationsService.accept(user.id, user.email, dto);
  }
}
