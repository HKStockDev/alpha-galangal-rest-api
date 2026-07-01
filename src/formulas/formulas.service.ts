import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MARKET_CONTENT_CLASSIFIER_FORMULA_KEY } from '../market-content/market-content-classifier.constants';
import { expandFormulaKeyAliases } from '../lib/formula-key-aliases';

export interface FormulaWeights {
  hedge_fund_performance: number;
  hedge_fund_risk: number;
  hedge_fund_conviction: number;
  hedge_fund_institutional_strength: number;
  hedge_fund_positioning: number;
}

export interface CommitteeMemberWeights {
  buffett: number;
  burry: number;
  druckenmiller: number;
  wood: number;
  graham: number;
  lynch: number;
}

const COMMITTEE_MEMBER_KEYS = ['buffett', 'burry', 'druckenmiller', 'wood', 'graham', 'lynch'] as const;
const COMMITTEE_FACTOR_KEY_BY_MEMBER: Record<(typeof COMMITTEE_MEMBER_KEYS)[number], string> = {
  buffett: 'buffett_score',
  burry: 'burry_score',
  druckenmiller: 'druckenmiller_score',
  wood: 'wood_score',
  graham: 'graham_score',
  lynch: 'lynch_score',
};
const DEFAULT_COMMITTEE_WEIGHTS: CommitteeMemberWeights = {
  buffett: 0.2,
  burry: 0.15,
  druckenmiller: 0.2,
  wood: 0.1,
  graham: 0.15,
  lynch: 0.2,
};
const ALPHA_GALANGAL_COMMITTEE_KEY = 'llm';

export interface FormulaDefinition {
  type: 'composite';
  weights: FormulaWeights;
}

export interface FormulaTerm {
  w: number;
  f: string;
  period_key?: string;
  period_months?: number;
}

export interface LlmFormulaDefinition {
  type: 'llm';
  member_weights?: CommitteeMemberWeights;
}

export interface Formula {
  id: string;
  key: string;
  name: string;
  output_type: string;
  definition: FormulaDefinition;
  display_formula: string;
  description: string;
  updated_at: string;
}

const QUALITY_SCORE_KEY = 'hedge_fund_quality_score';

const FUNDAMENTAL_CONSTRUCTION_SCORE_KEY = 'fundamental_constriction_score';
const POLITICAL_SCORE_KEY = 'political_score';

const STRUCTURAL_GROWTH_CAGR_SCORE_KEY = 'taxonomy_structural_growth_cagr_score';

const INSIDER_CONVICTION_SCORE_KEY = 'insider_conviction_score';

export const FC_COMPOSITE_WEIGHT_KEYS = [
  'fc_earnings_acceleration_pct',
  'fc_margin_expansion_pct',
  'fc_roic_improvement_pct',
  'fc_valuation_compression_pct',
  'fc_balance_sheet_strength_pct',
] as const;

export const PS_COMPOSITE_WEIGHT_KEYS = [
  'ps_committee_relevance_pct',
  'ps_trade_size_pct',
  'ps_recency_pct',
  'ps_influence_pct',
  'ps_cluster_pct',
] as const;

export const SG_CAGR_COMPOSITE_WEIGHT_KEYS = [
  'sg_cagr_score_3y',
  'sg_cagr_score_5y',
  'sg_cagr_score_10y',
] as const;

export type FundamentalConstrictionFormulaWeights = {
  [K in (typeof FC_COMPOSITE_WEIGHT_KEYS)[number]]: number;
};

export type PoliticalScoreFormulaWeights = {
  [K in (typeof PS_COMPOSITE_WEIGHT_KEYS)[number]]: number;
};

export type StructuralGrowthCagrFormulaWeights = {
  [K in (typeof SG_CAGR_COMPOSITE_WEIGHT_KEYS)[number]]: number;
};

/** Denominator for pressure_ratio (company-size normalization). */
export const INSIDER_CONVICTION_CAP_NORM_METHODS = [
  'market_cap',
  'enterprise_value',
  'revenue_ttm',
] as const;
export type InsiderConvictionCapNormMethod = (typeof INSIDER_CONVICTION_CAP_NORM_METHODS)[number];

/** SKE-36 / Formulas.md — `formulas.definition.params` when `definition.type` is `insider_conviction`. */
export interface InsiderConvictionFormulaParams {
  role_weight_ceo: number;
  role_weight_cfo: number;
  role_weight_chairman: number;
  role_weight_president: number;
  role_weight_director: number;
  role_weight_ten_percent_owner: number;
  role_weight_officer: number;
  recency_weight_0_30_days: number;
  recency_weight_31_60_days: number;
  recency_weight_61_90_days: number;
  signal_lookback_days: number;
  buy_cluster_multiplier_1: number;
  buy_cluster_multiplier_2: number;
  buy_cluster_multiplier_3_plus: number;
  sell_cluster_multiplier_1: number;
  sell_cluster_multiplier_2: number;
  sell_cluster_multiplier_3_plus: number;
  score_scaling_factor: number;
  minimum_trade_value_threshold_usd: number;
  included_transaction_types: string[];
  market_cap_normalization_method: InsiderConvictionCapNormMethod;
}

export const DEFAULT_INSIDER_CONVICTION_FORMULA_PARAMS: InsiderConvictionFormulaParams = {
  role_weight_ceo: 1.0,
  role_weight_cfo: 0.9,
  role_weight_chairman: 0.9,
  role_weight_president: 0.8,
  role_weight_director: 0.6,
  role_weight_ten_percent_owner: 0.7,
  role_weight_officer: 0.5,
  recency_weight_0_30_days: 1.0,
  recency_weight_31_60_days: 0.7,
  recency_weight_61_90_days: 0.4,
  signal_lookback_days: 90,
  buy_cluster_multiplier_1: 1.0,
  buy_cluster_multiplier_2: 1.2,
  buy_cluster_multiplier_3_plus: 1.5,
  sell_cluster_multiplier_1: 1.0,
  sell_cluster_multiplier_2: 1.1,
  sell_cluster_multiplier_3_plus: 1.25,
  score_scaling_factor: 800,
  minimum_trade_value_threshold_usd: 25_000,
  included_transaction_types: ['P', 'S'],
  market_cap_normalization_method: 'market_cap',
};

function buildFcDisplayFormula(weights: FundamentalConstrictionFormulaWeights): string {
  const w = weights;
  return `${w.fc_earnings_acceleration_pct.toFixed(2)}×EA + ${w.fc_margin_expansion_pct.toFixed(2)}×ME + ${w.fc_roic_improvement_pct.toFixed(2)}×ROIC + ${w.fc_valuation_compression_pct.toFixed(2)}×VC + ${w.fc_balance_sheet_strength_pct.toFixed(2)}×BS`;
}

function buildPsDisplayFormula(weights: PoliticalScoreFormulaWeights): string {
  const w = weights;
  return `100×(Buy−Sell)/(Buy+Sell+1); TradeScore = ${w.ps_committee_relevance_pct.toFixed(2)}·CR + ${w.ps_trade_size_pct.toFixed(2)}·TS + ${w.ps_recency_pct.toFixed(2)}·R + ${w.ps_influence_pct.toFixed(2)}·I + ${w.ps_cluster_pct.toFixed(2)}·C`;
}

function buildSgCagrDisplayFormula(weights: StructuralGrowthCagrFormulaWeights): string {
  const w = weights;
  return `${w.sg_cagr_score_3y.toFixed(2)}×score_3y + ${w.sg_cagr_score_5y.toFixed(2)}×score_5y + ${w.sg_cagr_score_10y.toFixed(2)}×score_10y`;
}

function buildInsiderConvictionDisplayFormula(p: InsiderConvictionFormulaParams): string {
  const types = p.included_transaction_types.slice().sort().join(',');
  return `100×tanh(ratio×${p.score_scaling_factor}); ${p.signal_lookback_days}d; min $${p.minimum_trade_value_threshold_usd}; norm=${p.market_cap_normalization_method}; types=${types}`;
}

function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function mergeInsiderConvictionParams(
  raw: Record<string, unknown> | null | undefined,
): InsiderConvictionFormulaParams {
  const out: InsiderConvictionFormulaParams = { ...DEFAULT_INSIDER_CONVICTION_FORMULA_PARAMS };
  if (!raw) return out;

  const numericKeys: (keyof Omit<
    InsiderConvictionFormulaParams,
    'included_transaction_types' | 'market_cap_normalization_method'
  >)[] = [
    'role_weight_ceo',
    'role_weight_cfo',
    'role_weight_chairman',
    'role_weight_president',
    'role_weight_director',
    'role_weight_ten_percent_owner',
    'role_weight_officer',
    'recency_weight_0_30_days',
    'recency_weight_31_60_days',
    'recency_weight_61_90_days',
    'buy_cluster_multiplier_1',
    'buy_cluster_multiplier_2',
    'buy_cluster_multiplier_3_plus',
    'sell_cluster_multiplier_1',
    'sell_cluster_multiplier_2',
    'sell_cluster_multiplier_3_plus',
    'score_scaling_factor',
    'minimum_trade_value_threshold_usd',
  ];
  const outNum = out as unknown as Record<string, number>;
  for (const k of numericKeys) {
    const n = coerceFiniteNumber(raw[k]);
    if (n !== null) outNum[k] = n;
  }

  const look = coerceFiniteNumber(raw.signal_lookback_days);
  if (look !== null) {
    out.signal_lookback_days = Math.min(500, Math.max(1, Math.round(look)));
  }

  const typesRaw = raw.included_transaction_types;
  if (Array.isArray(typesRaw)) {
    const codes = typesRaw
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    if (codes.length) out.included_transaction_types = [...new Set(codes)].sort();
  }

  const method = raw.market_cap_normalization_method;
  if (
    typeof method === 'string' &&
    (INSIDER_CONVICTION_CAP_NORM_METHODS as readonly string[]).includes(method)
  ) {
    out.market_cap_normalization_method = method as InsiderConvictionCapNormMethod;
  }

  return out;
}

export function assertValidInsiderConvictionParams(p: InsiderConvictionFormulaParams): void {
  const range05 = (label: string, v: number) => {
    if (!Number.isFinite(v) || v < 0 || v > 5) {
      throw new BadRequestException(`${label} must be a finite number between 0 and 5`);
    }
  };
  range05('Role weight: CEO', p.role_weight_ceo);
  range05('Role weight: CFO', p.role_weight_cfo);
  range05('Role weight: Chairman', p.role_weight_chairman);
  range05('Role weight: President', p.role_weight_president);
  range05('Role weight: Director', p.role_weight_director);
  range05('Role weight: 10% Owner', p.role_weight_ten_percent_owner);
  range05('Role weight: Officer', p.role_weight_officer);
  range05('Recency weight: 0–30 days', p.recency_weight_0_30_days);
  range05('Recency weight: 31–60 days', p.recency_weight_31_60_days);
  range05('Recency weight: 61–90 days', p.recency_weight_61_90_days);
  range05('Buy cluster multiplier: 1 insider', p.buy_cluster_multiplier_1);
  range05('Buy cluster multiplier: 2 insiders', p.buy_cluster_multiplier_2);
  range05('Buy cluster multiplier: 3+ insiders', p.buy_cluster_multiplier_3_plus);
  range05('Sell cluster multiplier: 1 insider', p.sell_cluster_multiplier_1);
  range05('Sell cluster multiplier: 2 insiders', p.sell_cluster_multiplier_2);
  range05('Sell cluster multiplier: 3+ insiders', p.sell_cluster_multiplier_3_plus);

  if (!Number.isFinite(p.signal_lookback_days) || p.signal_lookback_days < 1 || p.signal_lookback_days > 500) {
    throw new BadRequestException('Signal lookback window must be between 1 and 500 days');
  }
  if (!Number.isInteger(p.signal_lookback_days)) {
    throw new BadRequestException('Signal lookback window must be a whole number of days');
  }
  if (!Number.isFinite(p.score_scaling_factor) || p.score_scaling_factor <= 0 || p.score_scaling_factor > 1e6) {
    throw new BadRequestException('Score scaling factor must be a positive number up to 1,000,000');
  }
  if (
    !Number.isFinite(p.minimum_trade_value_threshold_usd) ||
    p.minimum_trade_value_threshold_usd < 0 ||
    p.minimum_trade_value_threshold_usd > 1e12
  ) {
    throw new BadRequestException('Minimum trade value threshold must be between 0 and 1e12 USD');
  }
  if (!p.included_transaction_types.length) {
    throw new BadRequestException('Select at least one included transaction type');
  }
  for (const c of p.included_transaction_types) {
    if (!/^[A-Z]$/.test(c)) {
      throw new BadRequestException(
        `Invalid transaction type "${c}" — use single-letter SEC codes (e.g. P, S)`,
      );
    }
  }
  if (!(INSIDER_CONVICTION_CAP_NORM_METHODS as readonly string[]).includes(p.market_cap_normalization_method)) {
    throw new BadRequestException('Invalid market cap normalization method');
  }
}

const COMPONENT_KEYS = [
  'hedge_fund_performance',
  'hedge_fund_risk',
  'hedge_fund_conviction',
  'hedge_fund_institutional_strength',
  'hedge_fund_positioning',
] as const;

export interface FormulaComponent {
  key: string;
  display_formula: string | null;
  description: string | null;
}

export interface FormulaPromptVersion {
  id: string;
  formula_id: string;
  version: number;
  status: string;
  system_prompt: string;
  user_prompt_template: string;
  output_schema: Record<string, unknown> | null;
  notes: string | null;
  model_name: string | null;
  temperature: number | null;
  top_p: number | null;
  max_output_tokens: number | null;
  created_at: string;
}

export type FormulaPromptVersionUpdate = Partial<Pick<
  FormulaPromptVersion,
  'status' | 'system_prompt' | 'user_prompt_template' | 'output_schema' | 'notes' | 'model_name' | 'temperature' | 'top_p' | 'max_output_tokens'
>>;

export interface CommitteeRunResult {
  ticker: string;
  member_scores: { buffett: number; burry: number; druckenmiller: number; wood: number; graham: number; lynch: number };
  weighted_score: number;
  confidence: number;
  summary: string;
  key_strengths: string[];
  key_risks: string[];
}

@Injectable()
export class FormulasService {
  private readonly logger = new Logger(FormulasService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private async getFirstRowByKeyAliases(
    table: 'formulas' | 'prompts',
    key: string,
    select: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.adminClient) return null;
    for (const k of expandFormulaKeyAliases(key)) {
      const { data, error } = await this.adminClient
        .from(table)
        .select(select)
        .eq('key', k)
        .maybeSingle();
      if (error) continue;
      if (data) return data as unknown as Record<string, unknown>;
    }
    return null;
  }

  private async getCommitteeFormulaRow(
    select: string,
  ): Promise<Record<string, unknown> | null> {
    return this.getFirstRowByKeyAliases('formulas', ALPHA_GALANGAL_COMMITTEE_KEY, select);
  }

  async getHedgeFundQualityScore(): Promise<{
    formula: Formula | null;
    components: Record<string, FormulaComponent>;
  }> {
    if (!this.adminClient) return { formula: null, components: {} };
    const { data: formula, error: formulaError } = await this.adminClient
      .from('formulas')
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .eq('key', QUALITY_SCORE_KEY)
      .single();

    if (formulaError || !formula) return { formula: null, components: {} };

    const { data: components, error: componentsError } = await this.adminClient
      .from('formulas')
      .select('key, display_formula, description')
      .in('key', [...COMPONENT_KEYS]);

    const componentsMap: Record<string, FormulaComponent> = {};
    if (!componentsError && components) {
      for (const c of components as { key: string; display_formula: string | null; description: string | null }[]) {
        componentsMap[c.key] = {
          key: c.key,
          display_formula: c.display_formula ?? null,
          description: c.description ?? null,
        };
      }
    }

    return { formula: formula as Formula, components: componentsMap };
  }

  async updateHedgeFundQualityScoreWeights(
    weights: FormulaWeights,
  ): Promise<Formula> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }

    const { data: existing, error: fetchError } = await this.adminClient
      .from('formulas')
      .select('id, definition')
      .eq('key', QUALITY_SCORE_KEY)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException('Hedge Fund Quality Score formula not found');
    }

    const def = existing.definition as FormulaDefinition;
    const newDefinition: FormulaDefinition = {
      type: 'composite',
      weights,
    };

    const { data: updated, error: updateError } = await this.adminClient
      .from('formulas')
      .update({
        definition: newDefinition,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .single();

    if (updateError) {
      throw new Error(`Failed to update formula: ${updateError.message}`);
    }

    await this.syncFormulaComponents(existing.id, weights);
    return updated as Formula;
  }

  async syncFormulaComponents(
    parentFormulaId: string,
    weights: FormulaWeights,
  ): Promise<void> {
    if (!this.adminClient) return;
    const { data: children } = await this.adminClient
      .from('formulas')
      .select('id, key')
      .in('key', Object.keys(weights) as (keyof FormulaWeights)[]);
    if (!children?.length) return;
    const keyToId = Object.fromEntries(children.map((c) => [c.key, c.id]));
    const { data: existing } = await this.adminClient
      .from('formula_components')
      .select('id, child_formula_id, weight')
      .eq('parent_formula_id', parentFormulaId);
    const existingByChild = new Map((existing ?? []).map((e) => [e.child_formula_id, e]));

    for (const [key, weight] of Object.entries(weights)) {
      const childId = keyToId[key];
      if (!childId || typeof weight !== 'number') continue;
      const row = existingByChild.get(childId);
      if (row) {
        if (row.weight !== weight) {
          await this.adminClient
            .from('formula_components')
            .update({ weight })
            .eq('id', row.id);
        }
      } else {
        await this.adminClient.from('formula_components').insert({
          parent_formula_id: parentFormulaId,
          child_formula_id: childId,
          weight,
        });
      }
    }
  }

  async getPromptVersionsByFormulaKey(formulaKey: string): Promise<FormulaPromptVersion[]> {
    if (!this.adminClient) return [];
    const formula = await this.getFirstRowByKeyAliases('formulas', formulaKey, 'id');
    if (!formula?.id) return [];
    const prompt = await this.getFirstRowByKeyAliases('prompts', formulaKey, 'id');
    if (!prompt?.id) return [];
    const { data, error } = await this.adminClient
      .from('prompt_versions')
      .select(
        'id, prompt_id, version, status, system_prompt, user_prompt_template, output_schema, notes, model_name, temperature, top_p, max_output_tokens, created_at',
      )
      .eq('prompt_id', prompt.id as string)
      .order('version', { ascending: true });
    if (error) throw new Error(`Failed to fetch prompt versions: ${error.message}`);
    return (data ?? []).map((row) => ({ ...row, formula_id: formula.id })) as FormulaPromptVersion[];
  }

  async getPromptVersionById(id: string): Promise<FormulaPromptVersion | null> {
    if (!this.adminClient) return null;
    const { data: pv, error } = await this.adminClient
      .from('prompt_versions')
      .select('id, prompt_id, version, status, system_prompt, user_prompt_template, output_schema, notes, model_name, temperature, top_p, max_output_tokens, created_at')
      .eq('id', id)
      .single();
    if (error || !pv) return null;
    const { data: prompt } = await this.adminClient
      .from('prompts')
      .select('key')
      .eq('id', pv.prompt_id)
      .single();
    if (!prompt?.key) return { ...pv, formula_id: '' } as FormulaPromptVersion;
    const formula = await this.getFirstRowByKeyAliases('formulas', String(prompt.key), 'id');
    return { ...pv, formula_id: (formula?.id as string | undefined) ?? '' } as FormulaPromptVersion;
  }

  async updatePromptVersion(
    id: string,
    body: FormulaPromptVersionUpdate,
  ): Promise<FormulaPromptVersion> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }
    const { data: existing, error: fetchError } = await this.adminClient
      .from('prompt_versions')
      .select('id')
      .eq('id', id)
      .single();
    if (fetchError || !existing) {
      throw new NotFoundException('Formula prompt version not found');
    }
    const payload: Record<string, unknown> = {};
    const allowed: (keyof FormulaPromptVersionUpdate)[] = [
      'status', 'system_prompt', 'user_prompt_template', 'output_schema', 'notes',
      'model_name', 'temperature', 'top_p', 'max_output_tokens',
    ];
    for (const k of allowed) {
      if (body[k] !== undefined) payload[k] = body[k];
    }
    if (Object.keys(payload).length === 0) {
      const one = await this.getPromptVersionById(id);
      if (!one) throw new NotFoundException('Formula prompt version not found');
      return one;
    }
    const { error: updateError } = await this.adminClient
      .from('prompt_versions')
      .update(payload)
      .eq('id', id);
    if (updateError) throw new Error(`Failed to update prompt version: ${updateError.message}`);
    const one = await this.getPromptVersionById(id);
    if (!one) throw new NotFoundException('Formula prompt version not found');
    return one;
  }

  async getCommitteeWeights(): Promise<CommitteeMemberWeights> {
    if (!this.adminClient) return { ...DEFAULT_COMMITTEE_WEIGHTS };
    const data = await this.getCommitteeFormulaRow('definition');
    if (!data?.definition) return { ...DEFAULT_COMMITTEE_WEIGHTS };
    const def = data.definition as LlmFormulaDefinition;
    const stored = def.member_weights;
    if (!stored) return { ...DEFAULT_COMMITTEE_WEIGHTS };
    return {
      buffett: stored.buffett ?? DEFAULT_COMMITTEE_WEIGHTS.buffett,
      burry: stored.burry ?? DEFAULT_COMMITTEE_WEIGHTS.burry,
      druckenmiller: stored.druckenmiller ?? DEFAULT_COMMITTEE_WEIGHTS.druckenmiller,
      wood: stored.wood ?? DEFAULT_COMMITTEE_WEIGHTS.wood,
      graham: stored.graham ?? DEFAULT_COMMITTEE_WEIGHTS.graham,
      lynch: stored.lynch ?? DEFAULT_COMMITTEE_WEIGHTS.lynch,
    };
  }

  async updateCommitteeWeights(weights: CommitteeMemberWeights): Promise<CommitteeMemberWeights> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }
    const existing = await this.getCommitteeFormulaRow('id, definition');
    if (!existing?.id) {
      throw new NotFoundException('Alpha Galangal Committee formula not found');
    }
    const def = (existing.definition as LlmFormulaDefinition) ?? { type: 'llm' };
    const newDef: LlmFormulaDefinition = { ...def, member_weights: weights };
    const { error: updateError } = await this.adminClient
      .from('formulas')
      .update({
        definition: newDef,
        updated_at: new Date().toISOString(),
      })
      .eq('id', String(existing.id));
    if (updateError) throw new Error(`Failed to update committee weights: ${updateError.message}`);
    return weights;
  }

  async getActiveCommitteePrompt(): Promise<FormulaPromptVersion | null> {
    if (!this.adminClient) return null;
    const formula = await this.getCommitteeFormulaRow('active_prompt_version_id');
    if (!formula?.active_prompt_version_id) return null;
    return this.getPromptVersionById(String(formula.active_prompt_version_id));
  }

  async updateActiveCommitteePrompt(body: FormulaPromptVersionUpdate): Promise<FormulaPromptVersion> {
    const prompt = await this.getActiveCommitteePrompt();
    if (!prompt) throw new NotFoundException('Alpha Galangal Committee active prompt not found');
    return this.updatePromptVersion(prompt.id, body);
  }

  /**
   * Active LLM prompt for events/news market content classification (CON-83 / CON-84 + CON-85 on one row).
   * CON-53 should use this instead of hardcoding prompt strings.
   */
  async getActiveMarketContentClassifierPrompt(): Promise<FormulaPromptVersion | null> {
    return this.getActivePromptVersionByPromptKey(MARKET_CONTENT_CLASSIFIER_FORMULA_KEY);
  }

  /**
   * Resolve prompts.active_prompt_version_id for a given prompts.key (for CON-53 and other pipelines).
   */
  async getActivePromptVersionByPromptKey(promptKey: string): Promise<FormulaPromptVersion | null> {
    if (!this.adminClient) return null;
    const { data: prompt } = await this.adminClient
      .from('prompts')
      .select('active_prompt_version_id')
      .eq('key', promptKey)
      .maybeSingle();
    if (!prompt?.active_prompt_version_id) return null;
    return this.getPromptVersionById(prompt.active_prompt_version_id);
  }

  private getGeminiApiKey(): string | undefined {
    const fromGeminiApiKey = this.config.get<string>('gemini.apiKey');
    const fromConfigEnv = this.config.get<string>('GEMINI_API_KEY');
    const fromProcessEnv = process.env.GEMINI_API_KEY;
    this.logger.log(
      `[Committee] GEMINI_API_KEY lookup: config(gemini.apiKey)=${fromGeminiApiKey ? 'SET' : 'NOT SET'}, config(GEMINI_API_KEY)=${fromConfigEnv ? 'SET' : 'NOT SET'}, process.env.GEMINI_API_KEY=${fromProcessEnv ? 'SET' : 'NOT SET'}, cwd=${process.cwd()}`,
    );
    return fromGeminiApiKey ?? fromConfigEnv ?? fromProcessEnv;
  }

  async isCommitteeRunConfigured(): Promise<{
    geminiConfigured: boolean;
    activePromptConfigured: boolean;
  }> {
    const geminiConfigured = !!this.getGeminiApiKey();
    const prompt = await this.getActiveCommitteePrompt();
    return { geminiConfigured, activePromptConfigured: !!prompt };
  }

  private async getOrCreateSecurityForTicker(ticker: string): Promise<string | null> {
    if (!this.adminClient) return null;
    const { data: existing } = await this.adminClient
      .from('securities')
      .select('id')
      .eq('market', 'stocks')
      .eq('locale', 'us')
      .eq('ticker', ticker)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data: inserted, error } = await this.adminClient
      .from('securities')
      .insert({
        ticker,
        market: 'stocks',
        locale: 'us',
        name: ticker,
        type_code: 'CS',
      })
      .select('id')
      .single();
    if (error || !inserted?.id) {
      this.logger.warn(`[Committee] Failed to create security for ticker=${ticker}: ${error?.message}`);
      return null;
    }
    return inserted.id;
  }

  private async getOrCreateEntityForSecurity(securityId: string, ticker: string, name: string): Promise<string | null> {
    if (!this.adminClient) return null;
    const { data: security } = await this.adminClient
      .from('securities')
      .select('entity_id')
      .eq('id', securityId)
      .single();
    if (security?.entity_id) return security.entity_id;
    const { data: byKey } = await this.adminClient
      .from('entities')
      .select('id')
      .eq('entity_type', 'security')
      .eq('key', ticker)
      .maybeSingle();
    if (byKey?.id) {
      await this.adminClient.from('securities').update({ entity_id: byKey.id }).eq('id', securityId);
      return byKey.id;
    }
    const { data: inserted, error } = await this.adminClient
      .from('entities')
      .insert({
        entity_type: 'security',
        key: ticker,
        name: name || ticker,
      })
      .select('id')
      .single();
    if (error || !inserted?.id) {
      this.logger.warn(`[Committee] Failed to create entity for security_id=${securityId}: ${error?.message}`);
      return null;
    }
    await this.adminClient.from('securities').update({ entity_id: inserted.id }).eq('id', securityId);
    return inserted.id;
  }

  private async persistCommitteeResult(
    ticker: string,
    result: CommitteeRunResult,
  ): Promise<void> {
    if (!this.adminClient) return;
    const now = new Date().toISOString();

    const securityId = await this.getOrCreateSecurityForTicker(ticker);
    if (!securityId) return;
    const entityId = await this.getOrCreateEntityForSecurity(securityId, ticker, result.ticker || ticker);
    if (!entityId) return;

    const formulaRow = await this.getCommitteeFormulaRow('id');
    if (!formulaRow?.id) {
      this.logger.warn('[Committee] Formula not found, skip persist');
      return;
    }
    const formulaId = String(formulaRow.id);

    const memberShortKeys = Object.values(COMMITTEE_FACTOR_KEY_BY_MEMBER) as string[];
    const keysToFetch = [...new Set(memberShortKeys.flatMap((k) => expandFormulaKeyAliases(k)))];
    const { data: factors } = await this.adminClient
      .from('factors')
      .select('id, key')
      .in('key', keysToFetch);
    const memberFactorId = (member: (typeof COMMITTEE_MEMBER_KEYS)[number]): string | undefined => {
      const shortK = COMMITTEE_FACTOR_KEY_BY_MEMBER[member];
      for (const k of expandFormulaKeyAliases(shortK)) {
        const f = (factors ?? []).find((row) => row.key === k);
        if (f?.id) return String(f.id);
      }
      return undefined;
    };

    const { error: scoreErr } = await this.adminClient.from('entity_scores_current').upsert(
      {
        entity_id: entityId,
        formula_id: formulaId,
        score: result.weighted_score,
        rank: null,
        explanation: {
          summary: result.summary,
          key_strengths: result.key_strengths,
          key_risks: result.key_risks,
          confidence: result.confidence,
        } as Record<string, unknown>,
        updated_at: now,
      },
      { onConflict: 'entity_id,formula_id' },
    );
    if (scoreErr) {
      this.logger.warn(`[Committee] entity_scores_current upsert failed: ${scoreErr.message}`);
      return;
    }

    await this.adminClient.from('entity_scores_history').insert({
      entity_id: entityId,
      formula_id: formulaId,
      score: result.weighted_score,
    });

    const modelVersion = 'v1';
    const periodKey = 'na';
    for (const member of COMMITTEE_MEMBER_KEYS) {
      const factorId = memberFactorId(member);
      if (!factorId) continue;
      const value = result.member_scores[member];
      if (typeof value !== 'number') continue;
      await this.adminClient.from('entity_factor_values').upsert(
        {
          entity_id: entityId,
          factor_id: factorId,
          value_num: value,
          updated_at: now,
          source: 'llm',
          ingested_at: now,
          model_version: modelVersion,
          period_key: periodKey,
        },
        { onConflict: 'entity_id,factor_id,model_version,period_key' },
      );
    }
    this.logger.log(`[Committee] Persisted result for ticker=${ticker}, entity_id=${entityId}`);
  }

  async runCommitteeForTicker(ticker: string): Promise<CommitteeRunResult> {
    this.logger.log(`[Committee] run requested for ticker=${ticker}`);
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      this.logger.warn('[Committee] GEMINI_API_KEY missing; check logs above for which lookup failed');
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured. Set it in the API server environment (e.g. .env or .env.development).',
      );
    }
    const prompt = await this.getActiveCommitteePrompt();
    if (!prompt) {
      throw new NotFoundException('Alpha Galangal Committee active prompt not found');
    }
    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    if (!normalizedTicker) {
      throw new BadRequestException('ticker is required');
    }
    const factorBundle = {
      ticker: normalizedTicker,
      note: `No entity factor data in database for this ticker; use public knowledge where appropriate.`,
      source: 'api',
    };
    const userText = (prompt.user_prompt_template ?? '')
      .replace(/\{\{ticker\}\}/g, normalizedTicker)
      .replace(/\{\{factor_bundle_json\}\}/g, JSON.stringify(factorBundle, null, 2));
    const modelId = (prompt.model_name ?? 'gemini-2.5-flash').startsWith('models/')
      ? prompt.model_name
      : `models/${prompt.model_name}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: prompt.temperature ?? 0.2,
        maxOutputTokens: Math.max(prompt.max_output_tokens ?? 800, 2048),
        responseMimeType: 'application/json',
      },
    };
    if (prompt.system_prompt) {
      body.systemInstruction = { parts: [{ text: prompt.system_prompt }] };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
    if (!res.ok) {
      const err = data?.error as { message?: string } | undefined;
      const msg =
        err?.message ??
        (data?.message as string | undefined) ??
        `Gemini API error: ${res.status} ${res.statusText}`;
      throw new InternalServerErrorException(`Committee run failed: ${msg}`);
    }
    const candidates = data?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    const parts = candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p: { text?: string }) => p?.text ?? '').join('');
    if (!text) {
      throw new InternalServerErrorException(
        'No text in Gemini response. The model may have been blocked or returned an empty result.',
      );
    }
    let raw = text.trim();
    const codeBlock = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
    if (codeBlock) raw = codeBlock[1].trim();
    try {
      const parsed = JSON.parse(raw) as CommitteeRunResult;
      if (!parsed?.ticker || typeof parsed.weighted_score !== 'number') {
        throw new InternalServerErrorException('Invalid committee response shape from LLM');
      }
      await this.persistCommitteeResult(normalizedTicker, parsed);
      return parsed;
    } catch (e) {
      if (e instanceof InternalServerErrorException) throw e;
      if (e instanceof SyntaxError) {
        throw new InternalServerErrorException(
          `Committee LLM did not return valid JSON. Raw: ${raw.slice(0, 200)}`,
        );
      }
      throw new InternalServerErrorException(
        e instanceof Error ? e.message : 'Committee run failed',
      );
    }
  }

  async getFundamentalConstrictionScore(): Promise<{
    formula: Formula | null;
    components: Record<string, FormulaComponent>;
  }> {
    if (!this.adminClient) return { formula: null, components: {} };
    const { data: formula, error: formulaError } = await this.adminClient
      .from('formulas')
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .eq('key', FUNDAMENTAL_CONSTRUCTION_SCORE_KEY)
      .single();

    if (formulaError || !formula) return { formula: null, components: {} };

    const { data: factors } = await this.adminClient
      .from('factors')
      .select('key, name, description')
      .in('key', [...FC_COMPOSITE_WEIGHT_KEYS]);

    const componentsMap: Record<string, FormulaComponent> = {};
    for (const f of factors ?? []) {
      const row = f as { key: string; name: string | null; description: string | null };
      componentsMap[row.key] = {
        key: row.key,
        display_formula: row.name ?? null,
        description: row.description ?? null,
      };
    }

    return { formula: formula as Formula, components: componentsMap };
  }

  async updateFundamentalConstrictionScoreWeights(
    weights: FundamentalConstrictionFormulaWeights,
  ): Promise<Formula> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }

    const { data: existing, error: fetchError } = await this.adminClient
      .from('formulas')
      .select('id, definition')
      .eq('key', FUNDAMENTAL_CONSTRUCTION_SCORE_KEY)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException('Fundamental Constriction Score formula not found');
    }

    const newDefinition = { type: 'composite' as const, weights };
    const display_formula = buildFcDisplayFormula(weights);

    const { data: updated, error: updateError } = await this.adminClient
      .from('formulas')
      .update({
        definition: newDefinition,
        display_formula,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .single();

    if (updateError) {
      throw new Error(`Failed to update formula: ${updateError.message}`);
    }

    return updated as Formula;
  }

  async getPoliticalScoreFormula(): Promise<{
    formula: Formula | null;
    components: Record<string, FormulaComponent>;
  }> {
    if (!this.adminClient) return { formula: null, components: {} };
    const { data: formula, error: formulaError } = await this.adminClient
      .from('formulas')
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .eq('key', POLITICAL_SCORE_KEY)
      .single();

    if (formulaError || !formula) return { formula: null, components: {} };

    const { data: factors } = await this.adminClient
      .from('factors')
      .select('key, name, description')
      .in('key', [...PS_COMPOSITE_WEIGHT_KEYS]);

    const componentsMap: Record<string, FormulaComponent> = {};
    for (const f of factors ?? []) {
      const row = f as { key: string; name: string | null; description: string | null };
      componentsMap[row.key] = {
        key: row.key,
        display_formula: row.name ?? null,
        description: row.description ?? null,
      };
    }

    return { formula: formula as Formula, components: componentsMap };
  }

  async updatePoliticalScoreWeights(weights: PoliticalScoreFormulaWeights): Promise<Formula> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }

    const { data: existing, error: fetchError } = await this.adminClient
      .from('formulas')
      .select('id, definition')
      .eq('key', POLITICAL_SCORE_KEY)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException('Political Score formula not found');
    }

    const newDefinition = { type: 'composite' as const, weights };
    const display_formula = buildPsDisplayFormula(weights);

    const { data: updated, error: updateError } = await this.adminClient
      .from('formulas')
      .update({
        definition: newDefinition,
        display_formula,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .single();

    if (updateError) {
      throw new Error(`Failed to update formula: ${updateError.message}`);
    }

    return updated as Formula;
  }

  async getStructuralGrowthCagrScoreFormula(): Promise<{
    formula: Formula | null;
    components: Record<string, FormulaComponent>;
  }> {
    if (!this.adminClient) return { formula: null, components: {} };
    const { data: formula, error: formulaError } = await this.adminClient
      .from('formulas')
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .eq('key', STRUCTURAL_GROWTH_CAGR_SCORE_KEY)
      .single();

    if (formulaError || !formula) return { formula: null, components: {} };

    const { data: factors } = await this.adminClient
      .from('factors')
      .select('key, name, description')
      .in('key', [...SG_CAGR_COMPOSITE_WEIGHT_KEYS]);

    const componentsMap: Record<string, FormulaComponent> = {};
    for (const f of factors ?? []) {
      const row = f as { key: string; name: string | null; description: string | null };
      componentsMap[row.key] = {
        key: row.key,
        display_formula: row.name ?? null,
        description: row.description ?? null,
      };
    }

    return { formula: formula as Formula, components: componentsMap };
  }

  async updateStructuralGrowthCagrScoreWeights(
    weights: StructuralGrowthCagrFormulaWeights,
  ): Promise<Formula> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }

    const { data: existing, error: fetchError } = await this.adminClient
      .from('formulas')
      .select('id, definition')
      .eq('key', STRUCTURAL_GROWTH_CAGR_SCORE_KEY)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException('Structural growth CAGR score formula not found');
    }

    const newDefinition = { type: 'composite' as const, weights };
    const display_formula = buildSgCagrDisplayFormula(weights);

    const { data: updated, error: updateError } = await this.adminClient
      .from('formulas')
      .update({
        definition: newDefinition,
        display_formula,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .single();

    if (updateError) {
      throw new Error(`Failed to update formula: ${updateError.message}`);
    }

    return updated as Formula;
  }

  async getInsiderConvictionScoreFormula(): Promise<{
    formula: Formula | null;
    components: Record<string, FormulaComponent>;
  }> {
    if (!this.adminClient) return { formula: null, components: {} };
    const { data: formula, error: formulaError } = await this.adminClient
      .from('formulas')
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .eq('key', INSIDER_CONVICTION_SCORE_KEY)
      .single();

    if (formulaError || !formula) return { formula: null, components: {} };

    const def = formula.definition as Record<string, unknown> | null;
    const paramsRaw =
      def?.type === 'insider_conviction' && def?.params && typeof def.params === 'object'
        ? (def.params as Record<string, unknown>)
        : {};
    const params = mergeInsiderConvictionParams(paramsRaw);
    const mergedFormula = {
      ...formula,
      definition: { type: 'insider_conviction' as const, params },
    };
    return { formula: mergedFormula as unknown as Formula, components: {} };
  }

  async updateInsiderConvictionScoreParams(params: InsiderConvictionFormulaParams): Promise<Formula> {
    if (!this.adminClient) {
      throw new Error('Supabase client not configured');
    }
    assertValidInsiderConvictionParams(params);

    const { data: existing, error: fetchError } = await this.adminClient
      .from('formulas')
      .select('id')
      .eq('key', INSIDER_CONVICTION_SCORE_KEY)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException('Insider Conviction Score formula not found');
    }

    const newDefinition = { type: 'insider_conviction' as const, params };
    const display_formula = buildInsiderConvictionDisplayFormula(params);

    const { data: updated, error: updateError } = await this.adminClient
      .from('formulas')
      .update({
        definition: newDefinition,
        display_formula,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, key, name, output_type, definition, display_formula, description, updated_at')
      .single();

    if (updateError) {
      throw new Error(`Failed to update formula: ${updateError.message}`);
    }

    return updated as unknown as Formula;
  }
}
