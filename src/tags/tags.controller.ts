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
import { CreateTagDto, ListTagsQueryDto, UpdateTagDto } from './dto';
import { TagRow, TagsService } from './tags.service';

@Controller('admin/tags')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  async list(@Query() query: ListTagsQueryDto): Promise<TagRow[]> {
    return this.tagsService.list(query.active_only, query.llm_assignable_only);
  }

  @Get(':tagId')
  async getOne(@Param('tagId', ParseUUIDPipe) tagId: string): Promise<TagRow> {
    return this.tagsService.getById(tagId);
  }

  @Post()
  async create(@Body() dto: CreateTagDto): Promise<TagRow> {
    return this.tagsService.create(dto);
  }

  @Patch(':tagId')
  async update(
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Body() dto: UpdateTagDto,
  ): Promise<TagRow> {
    return this.tagsService.update(tagId, dto);
  }

  @Delete(':tagId')
  @HttpCode(204)
  async remove(@Param('tagId', ParseUUIDPipe) tagId: string): Promise<void> {
    return this.tagsService.delete(tagId);
  }
}
