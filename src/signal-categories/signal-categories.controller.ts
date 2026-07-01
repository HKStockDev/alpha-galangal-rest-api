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
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateSignalCategoryDto, UpdateSignalCategoryDto } from './dto';
import { SignalCategoriesService, SignalCategoryRow } from './signal-categories.service';

@Controller('admin/signal-categories')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class SignalCategoriesController {
  constructor(private readonly signalCategoriesService: SignalCategoriesService) {}

  @Get()
  async list(): Promise<SignalCategoryRow[]> {
    return this.signalCategoriesService.list();
  }

  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string): Promise<SignalCategoryRow> {
    return this.signalCategoriesService.getById(id);
  }

  @Post()
  async create(@Body() dto: CreateSignalCategoryDto): Promise<SignalCategoryRow> {
    return this.signalCategoriesService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSignalCategoryDto,
  ): Promise<SignalCategoryRow> {
    return this.signalCategoriesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.signalCategoriesService.delete(id);
  }
}
