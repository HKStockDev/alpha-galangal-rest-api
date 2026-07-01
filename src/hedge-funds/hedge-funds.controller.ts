import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { HedgeFundsService } from './hedge-funds.service';
import { HedgeFundQualityScoreService } from './hedge-fund-quality-score.service';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';

@Controller('hedge-funds')
@UseGuards(SupabaseAuthGuard)
export class HedgeFundsController {
  private readonly logger = new Logger(HedgeFundsController.name);

  constructor(
    private readonly hedgeFundsService: HedgeFundsService,
    private readonly hedgeFundQualityScoreService: HedgeFundQualityScoreService,
  ) {}

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: 'asc' | 'desc',
    @Query('search') search?: string,
    @Query('minScore') minScore?: string,
    @Query('maxScore') maxScore?: string,
  ) {
    return this.hedgeFundsService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
      sort,
      order,
      search: search?.trim() || undefined,
      minScore: minScore != null ? parseFloat(minScore) : undefined,
      maxScore: maxScore != null ? parseFloat(maxScore) : undefined,
    });
  }

  @Post('calculate-quality-scores')
  async calculateQualityScores() {
    try {
      return await this.hedgeFundQualityScoreService.calculateQualityScores();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`calculateQualityScores failed: ${msg}`, err instanceof Error ? err.stack : undefined);
      throw new InternalServerErrorException(msg || 'Quality score calculation failed');
    }
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        const ok = file.mimetype === 'text/csv' || file.originalname?.toLowerCase().endsWith('.csv');
        cb(ok ? null : new BadRequestException('Only CSV files are allowed'), ok);
      },
    }),
  )
  async uploadCsv(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    return this.hedgeFundsService.uploadCsv(file.buffer);
  }
}
