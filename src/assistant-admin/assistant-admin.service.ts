import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ListGovernanceQueryDto } from './dto/list-governance-query.dto';
import { UpdateFactorGovernanceDto } from './dto/update-factor-governance.dto';
import { UpdateFormulaDisclosurePolicyDto } from './dto/update-formula-disclosure-policy.dto';
import { UpdateFormulaGovernanceDto } from './dto/update-formula-governance.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';

export type AiPromptTemplateRow = {
  id: string;
  template_key: string;
  template_text: string;
  required_context_keys: unknown;
  is_active: boolean;
  version: number;
  change_note: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type FormulaGovernanceRow = {
  id: string;
  key: string;
  name: string;
  organization_id: string | null;
  formula_origin: string;
  equation_visibility_mode: string;
  is_locked: boolean;
  source_formula_id: string | null;
};

export type FactorGovernanceRow = {
  id: string;
  key: string;
  name: string;
  organization_id: string | null;
  factor_origin: string;
  factor_visibility_mode: string;
  is_locked: boolean;
  source_factor_id: string | null;
};

@Injectable()
export class AssistantAdminService {
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private requireClient(): SupabaseClient {
    if (!this.adminClient) {
      throw new ServiceUnavailableException('Supabase is not configured.');
    }
    return this.adminClient;
  }

  async listPromptTemplates(): Promise<AiPromptTemplateRow[]> {
    const sb = this.requireClient();
    const { data, error } = await sb
      .from('ai_prompt_templates')
      .select(
        'id, template_key, template_text, required_context_keys, is_active, version, change_note, updated_by_user_id, created_at, updated_at',
      )
      .order('template_key', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as AiPromptTemplateRow[];
  }

  async updatePromptTemplate(
    id: string,
    dto: UpdatePromptTemplateDto,
    userId: string,
  ): Promise<AiPromptTemplateRow> {
    if (
      dto.template_text === undefined &&
      dto.change_note === undefined &&
      dto.is_active === undefined
    ) {
      throw new BadRequestException('No fields to update.');
    }
    const sb = this.requireClient();
    const { data: current, error: fetchErr } = await sb
      .from('ai_prompt_templates')
      .select('id, version')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw new BadRequestException(fetchErr.message);
    if (!current) throw new NotFoundException('Prompt template not found.');

    const patch: Record<string, unknown> = {
      updated_by_user_id: userId,
      version: (current as { version: number }).version + 1,
    };
    if (dto.template_text !== undefined) patch.template_text = dto.template_text;
    if (dto.change_note !== undefined) patch.change_note = dto.change_note;
    if (dto.is_active !== undefined) patch.is_active = dto.is_active;

    const { data, error } = await sb
      .from('ai_prompt_templates')
      .update(patch)
      .eq('id', id)
      .select(
        'id, template_key, template_text, required_context_keys, is_active, version, change_note, updated_by_user_id, created_at, updated_at',
      )
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as AiPromptTemplateRow;
  }

  async getFormulaDisclosurePolicy(): Promise<Record<string, unknown>> {
    const sb = this.requireClient();
    const { data, error } = await sb
      .from('ai_formula_disclosure_policies')
      .select('*')
      .eq('policy_key', 'default')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Formula disclosure policy not found.');
    return data as Record<string, unknown>;
  }

  async updateFormulaDisclosurePolicy(
    dto: UpdateFormulaDisclosurePolicyDto,
    userId: string,
  ): Promise<Record<string, unknown>> {
    if (
      dto.block_exact_equation_for_system_formulas === undefined &&
      dto.allow_factor_names === undefined &&
      dto.allow_weights === undefined
    ) {
      throw new BadRequestException('No fields to update.');
    }
    const sb = this.requireClient();
    const patch: Record<string, unknown> = { updated_by_user_id: userId };
    if (dto.block_exact_equation_for_system_formulas !== undefined) {
      patch.block_exact_equation_for_system_formulas =
        dto.block_exact_equation_for_system_formulas;
    }
    if (dto.allow_factor_names !== undefined) patch.allow_factor_names = dto.allow_factor_names;
    if (dto.allow_weights !== undefined) patch.allow_weights = dto.allow_weights;

    const { data, error } = await sb
      .from('ai_formula_disclosure_policies')
      .update(patch)
      .eq('policy_key', 'default')
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as Record<string, unknown>;
  }

  async getAssistantCoreConfig(): Promise<Record<string, unknown>> {
    const sb = this.requireClient();
    const { data, error } = await sb
      .from('assistant_core_config')
      .select('*')
      .eq('config_key', 'default')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Assistant core config not found.');
    return data as Record<string, unknown>;
  }

  async getScopePolicy(): Promise<Record<string, unknown>> {
    const sb = this.requireClient();
    const { data, error } = await sb
      .from('ai_scope_policies')
      .select('*')
      .eq('policy_key', 'default')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Scope policy not found.');
    return data as Record<string, unknown>;
  }

  async listFormulasGovernance(
    query: ListGovernanceQueryDto,
  ): Promise<{ rows: FormulaGovernanceRow[]; total: number }> {
    const sb = this.requireClient();
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    let q = sb
      .from('formulas')
      .select(
        'id, key, name, organization_id, formula_origin, equation_visibility_mode, is_locked, source_formula_id',
        { count: 'exact' },
      )
      .order('key', { ascending: true })
      .range(offset, offset + limit - 1);
    if (query.organization_id) {
      q = q.eq('organization_id', query.organization_id);
    }
    const { data, error, count } = await q;
    if (error) throw new BadRequestException(error.message);
    return { rows: (data ?? []) as FormulaGovernanceRow[], total: count ?? 0 };
  }

  async updateFormulaGovernance(
    formulaId: string,
    dto: UpdateFormulaGovernanceDto,
  ): Promise<FormulaGovernanceRow> {
    if (
      dto.formula_origin === undefined &&
      dto.equation_visibility_mode === undefined &&
      dto.is_locked === undefined &&
      dto.source_formula_id === undefined
    ) {
      throw new BadRequestException('No fields to update.');
    }
    const sb = this.requireClient();
    const patch: Record<string, unknown> = {};
    if (dto.formula_origin !== undefined) patch.formula_origin = dto.formula_origin;
    if (dto.equation_visibility_mode !== undefined) {
      patch.equation_visibility_mode = dto.equation_visibility_mode;
    }
    if (dto.is_locked !== undefined) patch.is_locked = dto.is_locked;
    if (dto.source_formula_id !== undefined) patch.source_formula_id = dto.source_formula_id;

    const { data, error } = await sb
      .from('formulas')
      .update(patch)
      .eq('id', formulaId)
      .select(
        'id, key, name, organization_id, formula_origin, equation_visibility_mode, is_locked, source_formula_id',
      )
      .single();
    if (error) {
      if (error.code === 'PGRST116') throw new NotFoundException('Formula not found.');
      throw new BadRequestException(error.message);
    }
    return data as FormulaGovernanceRow;
  }

  async listFactorsGovernance(
    query: ListGovernanceQueryDto,
  ): Promise<{ rows: FactorGovernanceRow[]; total: number }> {
    const sb = this.requireClient();
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    let q = sb
      .from('factors')
      .select(
        'id, key, name, organization_id, factor_origin, factor_visibility_mode, is_locked, source_factor_id',
        { count: 'exact' },
      )
      .order('key', { ascending: true })
      .range(offset, offset + limit - 1);
    if (query.organization_id) {
      q = q.eq('organization_id', query.organization_id);
    }
    const { data, error, count } = await q;
    if (error) throw new BadRequestException(error.message);
    return { rows: (data ?? []) as FactorGovernanceRow[], total: count ?? 0 };
  }

  async updateFactorGovernance(
    factorId: string,
    dto: UpdateFactorGovernanceDto,
  ): Promise<FactorGovernanceRow> {
    if (
      dto.factor_origin === undefined &&
      dto.factor_visibility_mode === undefined &&
      dto.is_locked === undefined &&
      dto.source_factor_id === undefined
    ) {
      throw new BadRequestException('No fields to update.');
    }
    const sb = this.requireClient();
    const patch: Record<string, unknown> = {};
    if (dto.factor_origin !== undefined) patch.factor_origin = dto.factor_origin;
    if (dto.factor_visibility_mode !== undefined) {
      patch.factor_visibility_mode = dto.factor_visibility_mode;
    }
    if (dto.is_locked !== undefined) patch.is_locked = dto.is_locked;
    if (dto.source_factor_id !== undefined) patch.source_factor_id = dto.source_factor_id;

    const { data, error } = await sb
      .from('factors')
      .update(patch)
      .eq('id', factorId)
      .select(
        'id, key, name, organization_id, factor_origin, factor_visibility_mode, is_locked, source_factor_id',
      )
      .single();
    if (error) {
      if (error.code === 'PGRST116') throw new NotFoundException('Factor not found.');
      throw new BadRequestException(error.message);
    }
    return data as FactorGovernanceRow;
  }
}
