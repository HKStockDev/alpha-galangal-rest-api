import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { FormulaMarketingService } from './formula-marketing.service';
import {
  CreateFormulaMarketingReleaseDto,
  ListFormulasMarketingQueryDto,
  ReplaceReleaseRowsDto,
  UpdateFormulaMarketingDto,
  UpdateFormulaMarketingReleaseDto,
} from './dto';

@Controller('admin/formula-marketing')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class FormulaMarketingController {
  constructor(private readonly svc: FormulaMarketingService) {}

  @Get('formulas')
  listFormulas(@Query() query: ListFormulasMarketingQueryDto) {
    return this.svc.listFormulas(query.organization_id);
  }

  @Get('formulas/:formulaId')
  getFormula(@Param('formulaId', ParseUUIDPipe) formulaId: string) {
    return this.svc.getFormula(formulaId);
  }

  @Get('formulas/:formulaId/history')
  getFormulaSyncHistory(@Param('formulaId', ParseUUIDPipe) formulaId: string) {
    return this.svc.getFormulaSyncHistory(formulaId);
  }

  @Patch('formulas/:formulaId')
  updateFormula(
    @Param('formulaId', ParseUUIDPipe) formulaId: string,
    @Body() dto: UpdateFormulaMarketingDto,
  ) {
    return this.svc.updateFormulaMarketing(formulaId, dto);
  }

  @Post('formulas/:formulaId/hero-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async uploadFormulaHero(
    @Param('formulaId', ParseUUIDPipe) formulaId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Missing file');
    }
    return this.svc.uploadFormulaHeroImage(formulaId, file);
  }

  @Delete('formulas/:formulaId/hero-image')
  @HttpCode(200)
  deleteFormulaHero(@Param('formulaId', ParseUUIDPipe) formulaId: string) {
    return this.svc.deleteFormulaHeroImage(formulaId);
  }

  @Post('formulas/:formulaId/seo-og-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async uploadFormulaSeoOg(
    @Param('formulaId', ParseUUIDPipe) formulaId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Missing file');
    }
    return this.svc.uploadFormulaSeoOgImage(formulaId, file);
  }

  @Delete('formulas/:formulaId/seo-og-image')
  @HttpCode(200)
  deleteFormulaSeoOg(@Param('formulaId', ParseUUIDPipe) formulaId: string) {
    return this.svc.deleteFormulaSeoOgImage(formulaId);
  }

  @Get('releases')
  listReleases(@Query('formula_id') formulaId?: string) {
    return this.svc.listReleases(formulaId);
  }

  @Get('releases/:releaseId')
  getRelease(@Param('releaseId', ParseUUIDPipe) releaseId: string) {
    return this.svc.getReleaseById(releaseId, true);
  }

  @Post('releases')
  createRelease(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateFormulaMarketingReleaseDto,
  ) {
    return this.svc.createRelease(dto, user.id);
  }

  @Patch('releases/:releaseId')
  updateRelease(
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateFormulaMarketingReleaseDto,
  ) {
    return this.svc.updateRelease(releaseId, user.id, dto);
  }

  @Delete('releases/:releaseId')
  @HttpCode(204)
  async deleteRelease(@Param('releaseId', ParseUUIDPipe) releaseId: string) {
    await this.svc.deleteRelease(releaseId);
  }

  @Post('releases/:releaseId/seo-og-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async uploadReleaseSeoOg(
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Missing file');
    }
    return this.svc.uploadReleaseSeoOgImage(releaseId, file);
  }

  @Delete('releases/:releaseId/seo-og-image')
  @HttpCode(200)
  deleteReleaseSeoOg(@Param('releaseId', ParseUUIDPipe) releaseId: string) {
    return this.svc.deleteReleaseSeoOgImage(releaseId);
  }

  @Put('releases/:releaseId/rows')
  replaceRows(
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @Body() dto: ReplaceReleaseRowsDto,
  ) {
    return this.svc.replaceReleaseRows(releaseId, dto);
  }
}
