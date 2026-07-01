import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { HedgeFundQualityScoreService } from '../hedge-funds/hedge-fund-quality-score.service';
import { FundamentalConstrictionScoreService } from '../fundamental-constriction/fundamental-constriction-score.service';
import { PoliticalScoreService } from '../political-score/political-score.service';
import { DataSyncOrchestratorService } from '../trigger/data-sync-orchestrator.service';
import {
  CommitteeMemberWeights,
  FC_COMPOSITE_WEIGHT_KEYS,
  FormulaPromptVersionUpdate,
  FormulasService,
  FormulaWeights,
  PS_COMPOSITE_WEIGHT_KEYS,
  SG_CAGR_COMPOSITE_WEIGHT_KEYS,
  FundamentalConstrictionFormulaWeights,
  PoliticalScoreFormulaWeights,
  StructuralGrowthCagrFormulaWeights,
  mergeInsiderPrecisionParams,
  assertValidInsiderPrecisionParams,
} from './formulas.service';
import { MarketContentClassifierPreviewService } from '../market-content/market-content-classifier-preview.service';
import { ContentCategoriesService } from '../market-content/content-categories.service';
import { TaxonomyStructuralGrowthService } from './taxonomy-structural-growth.service';

const COMMITTEE_MEMBER_WEIGHT_KEYS = [
  'buffett',
  'burry',
  'druckenmiller',
  'wood',
  'graham',
  'lynch',
] as const;

const REQUIRED_WEIGHT_KEYS = [
  'hedge_fund_performance',
  'hedge_fund_risk',
  'hedge_fund_precision',
  'hedge_fund_institutional_strength',
  'hedge_fund_positioning',
] as const;

@Controller('formulas')
@UseGuards(SupabaseAuthGuard)
export class FormulasController {
  private readonly logger = new Logger(FormulasController.name);

  constructor(
    private readonly formulasService: FormulasService,
    private readonly hedgeFundQualityScoreService: HedgeFundQualityScoreService,
    private readonly fundamentalConstrictionScoreService: FundamentalConstrictionScoreService,
    private readonly politicalScoreService: PoliticalScoreService,
    private readonly taxonomyStructuralGrowthService: TaxonomyStructuralGrowthService,
    private readonly marketContentClassifierPreviewService: MarketContentClassifierPreviewService,
    private readonly contentCategoriesService: ContentCategoriesService,
    private readonly syncOrchestrator: DataSyncOrchestratorService,
  ) {}

  @Get('hedge-fund-quality-score')
  async getHedgeFundQualityScore() {
    const result = await this.formulasService.getHedgeFundQualityScore();
    if (!result.formula) {
      return { formula: null, components: {} };
    }
    return { formula: result.formula, components: result.components };
  }

  @Patch('hedge-fund-quality-score')
  async updateHedgeFundQualityScore(@Body() body: { weights?: FormulaWeights }) {
    if (!body?.weights || typeof body.weights !== 'object') {
      throw new BadRequestException('weights object is required');
    }
    for (const key of REQUIRED_WEIGHT_KEYS) {
      const v = body.weights[key];
      if (typeof v !== 'number' || v < 0 || v > 1) {
        throw new BadRequestException(`Invalid weight for ${key}: must be a number between 0 and 1`);
      }
    }
    const weights = body.weights!;
    const sum = REQUIRED_WEIGHT_KEYS.reduce((s, k) => s + (weights[k] ?? 0), 0);
    if (sum > 1) {
      throw new BadRequestException('Sum of weights must not exceed 1');
    }
    if (Math.abs(sum - 1) > 0.0001) {
      throw new BadRequestException('Sum of weights must equal 1');
    }
    const formula = await this.formulasService.updateHedgeFundQualityScoreWeights(
      weights,
    );
    let recalc: Awaited<ReturnType<HedgeFundQualityScoreService['calculateQualityScores']>> | null = null;
    try {
      recalc = await this.hedgeFundQualityScoreService.calculateQualityScores();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Recalc after formula update failed: ${msg}`);
    }
    return { formula, recalc };
  }

  @Get('fundamental-constriction-score')
  async getFundamentalConstrictionScore() {
    const result = await this.formulasService.getFundamentalConstrictionScore();
    if (!result.formula) {
      return { formula: null, components: {} };
    }
    return { formula: result.formula, components: result.components };
  }

  @Patch('fundamental-constriction-score')
  async updateFundamentalConstrictionScore(
    @Body() body: { weights?: FundamentalConstrictionFormulaWeights },
  ) {
    if (!body?.weights || typeof body.weights !== 'object') {
      throw new BadRequestException('weights object is required');
    }
    for (const key of FC_COMPOSITE_WEIGHT_KEYS) {
      const v = body.weights[key];
      if (typeof v !== 'number' || v < 0 || v > 1) {
        throw new BadRequestException(`Invalid weight for ${key}: must be a number between 0 and 1`);
      }
    }
    const weights = body.weights;
    const sum = FC_COMPOSITE_WEIGHT_KEYS.reduce((s, k) => s + (weights[k] ?? 0), 0);
    if (sum > 1) {
      throw new BadRequestException('Sum of weights must not exceed 1');
    }
    if (Math.abs(sum - 1) > 0.0001) {
      throw new BadRequestException('Sum of weights must equal 1');
    }
    const formula = await this.formulasService.updateFundamentalConstrictionScoreWeights(weights);
    let recalc: Awaited<
      ReturnType<FundamentalConstrictionScoreService['calculateScores']>
    > | null = null;
    try {
      recalc = await this.fundamentalConstrictionScoreService.calculateScores({});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Recalc after fundamental constriction formula update failed: ${msg}`);
    }
    return { formula, recalc };
  }

  @Get('political-score')
  async getPoliticalScoreFormula() {
    const result = await this.formulasService.getPoliticalScoreFormula();
    if (!result.formula) {
      return { formula: null, components: {} };
    }
    return { formula: result.formula, components: result.components };
  }

  @Get('structural-growth-cagr-score')
  async getStructuralGrowthCagrScoreFormula() {
    const result = await this.formulasService.getStructuralGrowthCagrScoreFormula();
    if (!result.formula) {
      return { formula: null, components: {} };
    }
    return { formula: result.formula, components: result.components };
  }

  @Patch('structural-growth-cagr-score')
  async updateStructuralGrowthCagrScore(
    @Body() body: { weights?: StructuralGrowthCagrFormulaWeights },
  ) {
    if (!body?.weights || typeof body.weights !== 'object') {
      throw new BadRequestException('weights object is required');
    }
    for (const key of SG_CAGR_COMPOSITE_WEIGHT_KEYS) {
      const v = body.weights[key];
      if (typeof v !== 'number' || v < 0 || v > 1) {
        throw new BadRequestException(`Invalid weight for ${key}: must be a number between 0 and 1`);
      }
    }
    const weights = body.weights;
    const sum = SG_CAGR_COMPOSITE_WEIGHT_KEYS.reduce((s, k) => s + (weights[k] ?? 0), 0);
    if (sum > 1) {
      throw new BadRequestException('Sum of weights must not exceed 1');
    }
    if (Math.abs(sum - 1) > 0.0001) {
      throw new BadRequestException('Sum of weights must equal 1');
    }
    const formula = await this.formulasService.updateStructuralGrowthCagrScoreWeights(weights);
    let recalc: { entitiesUpdated: number } | null = null;
    try {
      recalc = await this.taxonomyStructuralGrowthService.recalculateAllCagrComposites();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Recalc CAGR composites after formula update failed: ${msg}`);
    }
    return { formula, recalc };
  }

  @Get('insider-precision-score')
  async getInsiderPrecisionScoreFormula() {
    const result = await this.formulasService.getInsiderPrecisionScoreFormula();
    if (!result.formula) {
      return { formula: null, components: {} };
    }
    return { formula: result.formula, components: result.components };
  }

  @Patch('insider-precision-score')
  async updateInsiderPrecisionScore(@Body() body: { params?: Record<string, unknown> }) {
    if (!body?.params || typeof body.params !== 'object' || Array.isArray(body.params)) {
      throw new BadRequestException('params object is required');
    }
    const merged = mergeInsiderPrecisionParams(body.params);
    assertValidInsiderPrecisionParams(merged);
    const formula = await this.formulasService.updateInsiderPrecisionScoreParams(merged);
    return { formula };
  }

  @Patch('political-score')
  async updatePoliticalScore(@Body() body: { weights?: PoliticalScoreFormulaWeights }) {
    if (!body?.weights || typeof body.weights !== 'object') {
      throw new BadRequestException('weights object is required');
    }
    for (const key of PS_COMPOSITE_WEIGHT_KEYS) {
      const v = body.weights[key];
      if (typeof v !== 'number' || v < 0 || v > 1) {
        throw new BadRequestException(`Invalid weight for ${key}: must be a number between 0 and 1`);
      }
    }
    const weights = body.weights;
    const sum = PS_COMPOSITE_WEIGHT_KEYS.reduce((s, k) => s + (weights[k] ?? 0), 0);
    if (sum > 1) {
      throw new BadRequestException('Sum of weights must not exceed 1');
    }
    if (Math.abs(sum - 1) > 0.0001) {
      throw new BadRequestException('Sum of weights must equal 1');
    }
    const formula = await this.formulasService.updatePoliticalScoreWeights(weights);
    let recalc: Awaited<ReturnType<PoliticalScoreService['calculateScores']>> | null = null;
    try {
      recalc = await this.politicalScoreService.calculateScores({});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Recalc after political score formula update failed: ${msg}`);
    }
    return { formula, recalc };
  }

  @Get('alpha-galangal-committee/weights')
  async getCommitteeWeights() {
    const weights = await this.formulasService.getCommitteeWeights();
    return { weights };
  }

  @Patch('alpha-galangal-committee/weights')
  async updateCommitteeWeights(@Body() body: { weights?: CommitteeMemberWeights }) {
    if (!body?.weights || typeof body.weights !== 'object') {
      throw new BadRequestException('weights object is required');
    }
    const weights = body.weights;
    for (const key of COMMITTEE_MEMBER_WEIGHT_KEYS) {
      const v = weights[key];
      if (typeof v !== 'number' || v < 0 || v > 1) {
        throw new BadRequestException(`Invalid weight for ${key}: must be a number between 0 and 1`);
      }
    }
    const sum = COMMITTEE_MEMBER_WEIGHT_KEYS.reduce((s, k) => s + (weights[k] ?? 0), 0);
    if (sum > 1) {
      throw new BadRequestException('Sum of weights must not exceed 1');
    }
    if (Math.abs(sum - 1) > 0.0001) {
      throw new BadRequestException('Sum of weights must equal 1');
    }
    return this.formulasService.updateCommitteeWeights(weights);
  }

  @Get('alpha-galangal-committee/active-prompt')
  async getActiveCommitteePrompt() {
    const prompt = await this.formulasService.getActiveCommitteePrompt();
    if (!prompt) throw new NotFoundException('Alpha Galangal Committee active prompt not found');
    return prompt;
  }

  @Patch('alpha-galangal-committee/active-prompt')
  async updateActiveCommitteePrompt(@Body() body: FormulaPromptVersionUpdate) {
    return this.formulasService.updateActiveCommitteePrompt(body);
  }

  @Get('alpha-galangal-committee/run/status')
  async getCommitteeRunStatus() {
    return this.formulasService.isCommitteeRunConfigured();
  }

  @Post('alpha-galangal-committee/run')
  async runCommittee(@Body() body: { ticker?: string }) {
    const ticker = body?.ticker;
    if (typeof ticker !== 'string' || !ticker.trim()) {
      throw new BadRequestException('ticker is required');
    }
    return this.formulasService.runCommitteeForTicker(ticker.trim());
  }

  @Get('prompt-versions')
  async getPromptVersions(@Query('formulaKey') formulaKey?: string) {
    if (!formulaKey) {
      throw new BadRequestException('formulaKey query is required');
    }
    return this.formulasService.getPromptVersionsByFormulaKey(formulaKey);
  }

  @Get('prompt-versions/:id')
  async getPromptVersion(@Param('id') id: string) {
    const version = await this.formulasService.getPromptVersionById(id);
    if (!version) throw new NotFoundException('Formula prompt version not found');
    return version;
  }

  @Patch('prompt-versions/:id')
  async updatePromptVersion(
    @Param('id') id: string,
    @Body() body: FormulaPromptVersionUpdate,
  ) {
    return this.formulasService.updatePromptVersion(id, body);
  }

  /** Read persisted taxonomy CAGR bucket scores / composite (any authenticated member). */
  @Get('taxonomy-structural-growth/cagr-scores')
  async getTaxonomyStructuralGrowthCagrScores(
    @Query('limit') limitStr?: string,
    @Query('entityType') entityType?: string,
  ) {
    let limit: number | undefined;
    if (limitStr !== undefined && limitStr !== '') {
      const n = parseInt(limitStr, 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new BadRequestException('limit must be a positive integer');
      }
      limit = n;
    }
    let entityTypeFilter: 'sector' | 'industry' | 'sub_industry' | undefined;
    if (entityType !== undefined && entityType !== '') {
      if (entityType !== 'sector' && entityType !== 'industry' && entityType !== 'sub_industry') {
        throw new BadRequestException('entityType must be sector, industry, or sub_industry');
      }
      entityTypeFilter = entityType;
    }
    return this.taxonomyStructuralGrowthService.getCagrScoresReadModel({
      limit,
      entityType: entityTypeFilter,
    });
  }

  @Get('taxonomy-structural-growth/status')
  @UseGuards(PlatformAdminGuard)
  async getTaxonomyStructuralGrowthStatus() {
    return this.taxonomyStructuralGrowthService.getRunStatus();
  }

  @Post('taxonomy-structural-growth/test-gemini')
  @UseGuards(PlatformAdminGuard)
  async testTaxonomyStructuralGrowthGemini() {
    return this.taxonomyStructuralGrowthService.testGeminiConnectivity();
  }

  @Post('taxonomy-structural-growth/run')
  @UseGuards(PlatformAdminGuard)
  async runTaxonomyStructuralGrowth(
    @Body() body: { limit?: number; delayMs?: number },
  ) {
    return this.taxonomyStructuralGrowthService.run({
      limit: body?.limit,
      delayMs: body?.delayMs,
    });
  }

  @Post('taxonomy-structural-growth/sync-cagr-scores')
  @UseGuards(PlatformAdminGuard)
  async syncTaxonomyStructuralGrowthCagrScores(@Body() body: { limit?: number }) {
    return this.syncOrchestrator.runTaxonomyStructuralGrowthCagrScores({
      limit: body?.limit,
    });
  }

  /**
   * Admin preview: FMP stock news for org tickers (or an explicit subset), then Gemini JSON
   * using the active `market_content_classifier` prompt. By default persists validated output to
   * `market_content` + `market_content_entities` (set `persist: false` for a dry run only).
   */
  @Post('market-content-classifier/preview')
  @UseGuards(PlatformAdminGuard)
  async previewMarketContentClassifier(
    @Body()
    body: {
      organization_id?: string;
      ticker_symbols?: string[];
      equity_page_limit?: number;
      equity_query?: string;
      sector_cycles?: number[];
      industry_cycles?: number[];
      sub_industry_cycles?: number[];
      cycle_horizon?: '1m' | '3m' | '6m' | '12m' | '24m';
      from?: string;
      to?: string;
      max_news?: number;
      classify_count?: number;
      persist?: boolean;
      con51_aggregate_windows?: '30d' | '90d' | 'both';
    },
  ) {
    if (!body?.organization_id || typeof body.organization_id !== 'string') {
      throw new BadRequestException('organization_id is required');
    }
    return this.marketContentClassifierPreviewService.run({
      organization_id: body.organization_id,
      ticker_symbols: body.ticker_symbols,
      equity_page_limit: body.equity_page_limit,
      equity_query: body.equity_query,
      sector_cycles: body.sector_cycles,
      industry_cycles: body.industry_cycles,
      sub_industry_cycles: body.sub_industry_cycles,
      cycle_horizon: body.cycle_horizon,
      from: body.from,
      to: body.to,
      max_news: body.max_news,
      classify_count: body.classify_count,
      persist: body.persist,
      con51_aggregate_windows: body.con51_aggregate_windows,
    });
  }

  @Get('market-content-categories')
  @UseGuards(PlatformAdminGuard)
  async listMarketContentCategories(
    @Query('include_inactive') includeInactive?: string,
  ) {
    const include =
      typeof includeInactive === 'string'
        ? ['1', 'true', 'yes'].includes(includeInactive.trim().toLowerCase())
        : false;
    return this.contentCategoriesService.listCategories({ includeInactive: include });
  }

  @Post('market-content-categories')
  @UseGuards(PlatformAdminGuard)
  async createMarketContentCategory(
    @Body()
    body: {
      key?: string;
      label?: string;
      description?: string | null;
      is_active?: boolean;
      sort_order?: number;
    },
  ) {
    if (!body?.key || !body?.label) {
      throw new BadRequestException('key and label are required');
    }
    return this.contentCategoriesService.createCategory({
      key: body.key,
      label: body.label,
      description: body.description,
      is_active: body.is_active,
      sort_order: body.sort_order,
    });
  }

  @Patch('market-content-categories/:id')
  @UseGuards(PlatformAdminGuard)
  async updateMarketContentCategory(
    @Param('id') id: string,
    @Body()
    body: {
      key?: string;
      label?: string;
      description?: string | null;
      is_active?: boolean;
      sort_order?: number;
    },
  ) {
    return this.contentCategoriesService.updateCategory(id, body);
  }
}
