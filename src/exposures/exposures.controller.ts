import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateExposureDto, ListExposuresQueryDto, UpdateExposureDto } from './dto';
import { ExposureRow, ExposuresService } from './exposures.service';

@Controller('admin/exposures')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class ExposuresController {
  constructor(private readonly exposuresService: ExposuresService) {}

  @Get()
  async list(@Query() query: ListExposuresQueryDto): Promise<ExposureRow[]> {
    return this.exposuresService.list(query.active_only);
  }

  @Get(':exposureId')
  async getOne(@Param('exposureId', ParseUUIDPipe) exposureId: string): Promise<ExposureRow> {
    return this.exposuresService.getById(exposureId);
  }

  @Post()
  async create(@Body() dto: CreateExposureDto): Promise<ExposureRow> {
    return this.exposuresService.create(dto);
  }

  @Patch(':exposureId')
  async update(
    @Param('exposureId', ParseUUIDPipe) exposureId: string,
    @Body() dto: UpdateExposureDto,
  ): Promise<ExposureRow> {
    return this.exposuresService.update(exposureId, dto);
  }

  @Delete(':exposureId')
  @HttpCode(204)
  async remove(@Param('exposureId', ParseUUIDPipe) exposureId: string): Promise<void> {
    return this.exposuresService.delete(exposureId);
  }
}
