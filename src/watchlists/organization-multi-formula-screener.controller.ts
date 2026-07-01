import {
  Body,
  Controller,
  Get,
  Param,
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
  ConvertMultiFormulaScreenerDto,
  ExportWatchlistQueryDto,
  MultiFormulaScreenerQueryDto,
} from './dto';
import { WatchlistsService } from './watchlists.service';

@Controller('organizations/:organizationId/multi-formula-screener')
@UseGuards(SupabaseAuthGuard, OrgMemberGuard)
export class OrganizationMultiFormulaScreenerController {
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
    query: MultiFormulaScreenerQueryDto,
  ) {
    return this.watchlistsService.listMultiFormulaScreener(
      organizationId,
      user.id,
      query,
    );
  }

  @Get('export')
  exportCsv(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: MultiFormulaScreenerQueryDto & ExportWatchlistQueryDto,
    @Res() res: Response,
  ) {
    void query.format;
    return this.watchlistsService
      .exportMultiFormulaScreenerCsv(organizationId, user.id, query)
      .then(({ body, filename }) => {
        const safeName = filename.replace(/[^\w.-]+/g, '_');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        return res.send(Buffer.from(body, 'utf8'));
      });
  }

  @Post('convert-to-watchlist')
  convertToWatchlist(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: MultiFormulaScreenerQueryDto,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dto: ConvertMultiFormulaScreenerDto,
  ) {
    return this.watchlistsService.convertMultiFormulaScreenerToWatchlist(
      organizationId,
      user.id,
      query,
      dto,
    );
  }
}
