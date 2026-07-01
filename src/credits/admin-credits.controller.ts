import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreditsService } from './credits.service';
import {
  ListAdminCreditTransactionsQueryDto,
  ListAdminCreditWalletsQueryDto,
  UpdateCapabilityCreditCostDto,
  UpdateCreditPolicyDto,
} from './dto/admin-credits.dto';

@Controller('admin/monetization')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class AdminCreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('credit-packs')
  listCreditPacks() {
    return this.creditsService.listCreditPacksAdmin();
  }

  @Post('credit-packs/sync-stripe')
  syncCreditPacksFromStripe() {
    return this.creditsService.syncCreditPacksFromStripe();
  }

  @Get('credit-costs')
  listCreditCosts() {
    return this.creditsService.listCapabilityCreditCosts();
  }

  @Patch('credit-costs/:capabilityKey')
  updateCreditCost(
    @Param('capabilityKey') capabilityKey: string,
    @Body() dto: UpdateCapabilityCreditCostDto,
  ) {
    return this.creditsService.updateCapabilityCreditCost(capabilityKey, dto);
  }

  @Get('credit-policy')
  getCreditPolicy() {
    return this.creditsService.getPolicyConfig();
  }

  @Patch('credit-policy')
  updateCreditPolicy(
    @Body() dto: UpdateCreditPolicyDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.creditsService.updateCreditPolicy(dto, user.id);
  }

  @Get('credit-wallets')
  listCreditWallets(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    query: ListAdminCreditWalletsQueryDto,
  ) {
    return this.creditsService.listAdminWallets(query);
  }

  @Get('credit-transactions')
  listCreditTransactions(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    query: ListAdminCreditTransactionsQueryDto,
  ) {
    return this.creditsService.listAdminTransactions(query);
  }

  @Post('credit-lots/expire')
  expireLots() {
    return this.creditsService.expireExpiredLots();
  }
}
