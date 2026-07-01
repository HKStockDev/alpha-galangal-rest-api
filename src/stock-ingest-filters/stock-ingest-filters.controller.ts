import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  RequestUser,
} from '../auth/decorators/current-user.decorator';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { PatchStockIngestFiltersDto } from './dto/patch-stock-ingest-filters.dto';
import { StockIngestFiltersResponseDto } from './dto/stock-ingest-filters-response.dto';
import { StockIngestFiltersService } from './stock-ingest-filters.service';

@Controller('admin/stock-ingest-filters')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class StockIngestFiltersController {
  constructor(private readonly stockIngestFiltersService: StockIngestFiltersService) {}

  @Get()
  async getFilters(): Promise<StockIngestFiltersResponseDto> {
    return this.stockIngestFiltersService.getFilters();
  }

  @Patch()
  async patchFilters(
    @Body() dto: PatchStockIngestFiltersDto,
    @CurrentUser() user: RequestUser,
  ): Promise<StockIngestFiltersResponseDto> {
    return this.stockIngestFiltersService.patchFilters(dto, user.id);
  }
}
