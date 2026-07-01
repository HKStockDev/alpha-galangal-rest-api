import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { OrgMemberGuard } from '../organizations/guards/org-member.guard';
import { AddWatchlistSecurityDto, UpdateWatchlistSecurityItemDto } from './dto';
import { WatchlistsService } from './watchlists.service';

@Controller('organizations/:organizationId/watchlists/:watchlistId/securities')
@UseGuards(SupabaseAuthGuard, OrgMemberGuard)
export class OrganizationWatchlistSecuritiesController {
  constructor(private readonly watchlistsService: WatchlistsService) {}

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.watchlistsService.listSecurities(
      organizationId,
      user.id,
      watchlistId,
    );
  }

  @Post()
  add(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AddWatchlistSecurityDto,
  ) {
    return this.watchlistsService.addSecurity(
      organizationId,
      user.id,
      watchlistId,
      dto,
    );
  }

  @Patch(':itemId')
  updateItem(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateWatchlistSecurityItemDto,
  ) {
    return this.watchlistsService.updateSecurityItem(
      organizationId,
      user.id,
      watchlistId,
      itemId,
      dto,
    );
  }

  @Delete(':itemId')
  removeItem(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.watchlistsService.removeSecurityItem(
      organizationId,
      user.id,
      watchlistId,
      itemId,
    );
  }
}
