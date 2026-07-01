import { Controller, Get, Param, Post, Query, UseGuards, ValidationPipe, Body } from '@nestjs/common';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { OrgAdminGuard } from '../organizations/guards/org-admin.guard';
import { OrgMemberGuard } from '../organizations/guards/org-member.guard';
import { CreditsService } from './credits.service';
import { CreateCreditPackCheckoutDto } from './dto/create-credit-pack-checkout.dto';
import { ListCreditTransactionsQueryDto } from './dto/list-credit-transactions-query.dto';

@Controller('organizations/:organizationId/credits')
@UseGuards(SupabaseAuthGuard)
export class OrganizationCreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('wallet')
  @UseGuards(OrgMemberGuard)
  getWallet(@Param('organizationId') organizationId: string) {
    return this.creditsService.getWallet(organizationId);
  }

  @Get('transactions')
  @UseGuards(OrgMemberGuard)
  listTransactions(
    @Param('organizationId') organizationId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    query: ListCreditTransactionsQueryDto,
  ) {
    return this.creditsService.listTransactions(organizationId, query);
  }

  @Get('packs')
  @UseGuards(OrgMemberGuard)
  listPacks() {
    return this.creditsService.listActiveCreditPacks();
  }

  @Post('checkout')
  @UseGuards(OrgAdminGuard)
  createCheckout(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCreditPackCheckoutDto,
  ) {
    return this.creditsService.createCreditPackCheckoutSession({
      organizationId,
      packKey: dto.pack_key,
      billingEmail: user.email,
    });
  }
}
