import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { OrgMemberGuard } from '../organizations/guards/org-member.guard';
import {
  ConvertWatchlistScopeDto,
  CreateOrganizationWatchlistDto,
  DuplicateOrganizationWatchlistDto,
  ExportWatchlistQueryDto,
  ListOrganizationWatchlistsQueryDto,
  UpdateOrganizationWatchlistDto,
} from './dto';
import { WatchlistsService } from './watchlists.service';

const watchlistMutationBodyPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller('organizations/:organizationId/watchlists')
@UseGuards(SupabaseAuthGuard, OrgMemberGuard)
export class OrganizationWatchlistsController {
  constructor(private readonly watchlistsService: WatchlistsService) {}

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    query: ListOrganizationWatchlistsQueryDto,
  ) {
    return this.watchlistsService.listWatchlists(organizationId, user.id, query);
  }

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateOrganizationWatchlistDto,
  ) {
    return this.watchlistsService.createWatchlist(organizationId, user.id, dto);
  }

  @Get(':watchlistId/export')
  exportCsv(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @CurrentUser() user: { id: string },
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: ExportWatchlistQueryDto,
    @Res() res: Response,
  ) {
    void query.format;
    return this.watchlistsService
      .exportWatchlistCsv(organizationId, user.id, watchlistId)
      .then(({ body, filename }) => {
        const safeName = filename.replace(/[^\w.-]+/g, '_');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        return res.send(Buffer.from(body, 'utf8'));
      });
  }

  @Post(':watchlistId/duplicate')
  duplicate(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @CurrentUser() user: { id: string },
    @Body(watchlistMutationBodyPipe) dto: DuplicateOrganizationWatchlistDto,
  ) {
    return this.watchlistsService.duplicateWatchlist(
      organizationId,
      user.id,
      watchlistId,
      dto,
    );
  }

  @Post(':watchlistId/convert-scope')
  convertScope(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @CurrentUser() user: { id: string },
    @Body(watchlistMutationBodyPipe) dto: ConvertWatchlistScopeDto,
  ) {
    return this.watchlistsService.convertWatchlistScope(
      organizationId,
      user.id,
      watchlistId,
      dto,
    );
  }

  @Get(':watchlistId')
  getOne(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.watchlistsService.getOwnedWatchlist(
      organizationId,
      user.id,
      watchlistId,
    );
  }

  @Patch(':watchlistId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateOrganizationWatchlistDto,
  ) {
    return this.watchlistsService.updateWatchlist(
      organizationId,
      user.id,
      watchlistId,
      dto,
    );
  }

  @Delete(':watchlistId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('watchlistId') watchlistId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.watchlistsService.deleteWatchlist(
      organizationId,
      user.id,
      watchlistId,
    );
  }
}
