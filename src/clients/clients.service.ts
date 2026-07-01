import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  CreateClientEntityDto,
  CreateOrganizationClientDto,
  UpdateClientEntityDto,
  UpdateOrganizationClientDto,
} from './dto';

@Injectable()
export class ClientsService {
  private adminClient: SupabaseClient | null = null;

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  private supabase(): SupabaseClient {
    if (!this.adminClient) {
      throw new BadRequestException('Service unavailable');
    }
    return this.adminClient;
  }

  async listClients(organizationId: string) {
    const sb = this.supabase();
    const { data, error } = await sb
      .from('organization_clients')
      .select('*')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true });

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data ?? [];
  }

  async createClient(organizationId: string, dto: CreateOrganizationClientDto) {
    const sb = this.supabase();
    const { data, error } = await sb
      .from('organization_clients')
      .insert({
        organization_id: organizationId,
        name: dto.name,
        client_type: dto.client_type,
      })
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async getClient(organizationId: string, clientId: string) {
    const sb = this.supabase();
    const { data, error } = await sb
      .from('organization_clients')
      .select('*')
      .eq('id', clientId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Client not found');
    }
    return data;
  }

  async updateClient(
    organizationId: string,
    clientId: string,
    dto: UpdateOrganizationClientDto,
  ) {
    await this.getClient(organizationId, clientId);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.client_type !== undefined) patch.client_type = dto.client_type;
    if (Object.keys(patch).length === 0) {
      return this.getClient(organizationId, clientId);
    }

    const sb = this.supabase();
    const { data, error } = await sb
      .from('organization_clients')
      .update(patch)
      .eq('id', clientId)
      .eq('organization_id', organizationId)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async deleteClient(organizationId: string, clientId: string) {
    await this.getClient(organizationId, clientId);
    const sb = this.supabase();
    const { error } = await sb
      .from('organization_clients')
      .delete()
      .eq('id', clientId)
      .eq('organization_id', organizationId);

    if (error) {
      throw new BadRequestException(error.message);
    }
  }

  async listEntities(organizationId: string, clientId: string) {
    await this.getClient(organizationId, clientId);
    const sb = this.supabase();
    const { data, error } = await sb
      .from('client_entities')
      .select('*')
      .eq('client_id', clientId)
      .order('display_order', { ascending: true })
      .order('display_name', { ascending: true });

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data ?? [];
  }

  private entityInsertFromDto(
    clientId: string,
    dto: CreateClientEntityDto,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {
      client_id: clientId,
      display_name: dto.display_name,
    };
    if (dto.relationship_role !== undefined) {
      row.relationship_role = dto.relationship_role;
    }
    if (dto.entity_type !== undefined) row.entity_type = dto.entity_type;
    if (dto.legal_name !== undefined) row.legal_name = dto.legal_name;
    if (dto.date_of_birth !== undefined) row.date_of_birth = dto.date_of_birth;
    if (dto.incorporation_date !== undefined) row.incorporation_date = dto.incorporation_date;
    if (dto.tax_id !== undefined) row.tax_id = dto.tax_id;
    if (dto.national_id !== undefined) row.national_id = dto.national_id;
    if (dto.passport_no !== undefined) row.passport_no = dto.passport_no;
    if (dto.country_of_residence !== undefined) row.country_of_residence = dto.country_of_residence;
    if (dto.country_of_incorporation !== undefined) {
      row.country_of_incorporation = dto.country_of_incorporation;
    }
    if (dto.tax_residency !== undefined) row.tax_residency = dto.tax_residency;
    if (dto.kyc_status !== undefined) row.kyc_status = dto.kyc_status;
    if (dto.kyc_verified_at !== undefined) row.kyc_verified_at = dto.kyc_verified_at;
    if (dto.aml_risk_level !== undefined) row.aml_risk_level = dto.aml_risk_level;
    if (dto.pep_flag !== undefined) row.pep_flag = dto.pep_flag;
    if (dto.sanctions_flag !== undefined) row.sanctions_flag = dto.sanctions_flag;
    if (dto.parent_entity_id !== undefined) row.parent_entity_id = dto.parent_entity_id;
    if (dto.beneficial_owner_of !== undefined) row.beneficial_owner_of = dto.beneficial_owner_of;
    if (dto.ownership_percent !== undefined) row.ownership_percent = dto.ownership_percent;
    if (dto.onboarding_status !== undefined) row.onboarding_status = dto.onboarding_status;
    if (dto.client_status !== undefined) row.client_status = dto.client_status;
    if (dto.closed_at !== undefined) row.closed_at = dto.closed_at;
    if (dto.closure_reason !== undefined) row.closure_reason = dto.closure_reason;
    if (dto.source_system !== undefined) row.source_system = dto.source_system;
    if (dto.source_system_id !== undefined) row.source_system_id = dto.source_system_id;
    if (dto.created_by !== undefined) row.created_by = dto.created_by;
    if (dto.updated_by !== undefined) row.updated_by = dto.updated_by;
    if (dto.version !== undefined) row.version = dto.version;
    if (dto.relationship_role_other !== undefined) {
      row.relationship_role_other = dto.relationship_role_other;
    }
    if (dto.risk_score !== undefined) row.risk_score = dto.risk_score;
    if (dto.risk_notes !== undefined) row.risk_notes = dto.risk_notes;
    if (dto.time_horizon_category !== undefined) {
      row.time_horizon_category = dto.time_horizon_category;
    }
    if (dto.time_horizon_detail !== undefined) {
      row.time_horizon_detail = dto.time_horizon_detail;
    }
    if (dto.investment_objectives !== undefined) {
      row.investment_objectives = dto.investment_objectives;
    }
    if (dto.investment_objectives_notes !== undefined) {
      row.investment_objectives_notes = dto.investment_objectives_notes;
    }
    if (dto.liquidity_needs !== undefined) row.liquidity_needs = dto.liquidity_needs;
    if (dto.liquidity_notes !== undefined) row.liquidity_notes = dto.liquidity_notes;
    if (dto.tax_account_types !== undefined) {
      row.tax_account_types = dto.tax_account_types;
    }
    if (dto.tax_account_notes !== undefined) row.tax_account_notes = dto.tax_account_notes;
    if (dto.special_preferences_tags !== undefined) {
      row.special_preferences_tags = dto.special_preferences_tags;
    }
    if (dto.special_preferences_notes !== undefined) {
      row.special_preferences_notes = dto.special_preferences_notes;
    }
    if (dto.age !== undefined) row.age = dto.age;
    if (dto.life_stage !== undefined) row.life_stage = dto.life_stage;
    if (dto.notes !== undefined) row.notes = dto.notes;
    if (dto.settings_json !== undefined) row.settings_json = dto.settings_json;
    if (dto.display_order !== undefined) row.display_order = dto.display_order;
    return row;
  }

  private entityPatchFromDto(dto: UpdateClientEntityDto): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    const keys = [
      'display_name',
      'entity_type',
      'legal_name',
      'date_of_birth',
      'incorporation_date',
      'tax_id',
      'national_id',
      'passport_no',
      'country_of_residence',
      'country_of_incorporation',
      'tax_residency',
      'kyc_status',
      'kyc_verified_at',
      'aml_risk_level',
      'pep_flag',
      'sanctions_flag',
      'parent_entity_id',
      'beneficial_owner_of',
      'ownership_percent',
      'onboarding_status',
      'client_status',
      'closed_at',
      'closure_reason',
      'source_system',
      'source_system_id',
      'created_by',
      'updated_by',
      'version',
      'relationship_role',
      'relationship_role_other',
      'risk_score',
      'risk_notes',
      'time_horizon_category',
      'time_horizon_detail',
      'investment_objectives',
      'investment_objectives_notes',
      'liquidity_needs',
      'liquidity_notes',
      'tax_account_types',
      'tax_account_notes',
      'special_preferences_tags',
      'special_preferences_notes',
      'age',
      'life_stage',
      'notes',
      'settings_json',
      'display_order',
    ] as const;
    for (const k of keys) {
      if (dto[k] !== undefined) {
        patch[k] = dto[k] as unknown;
      }
    }
    return patch;
  }

  async createEntity(
    organizationId: string,
    clientId: string,
    dto: CreateClientEntityDto,
  ) {
    await this.getClient(organizationId, clientId);
    const sb = this.supabase();
    const { data, error } = await sb
      .from('client_entities')
      .insert(this.entityInsertFromDto(clientId, dto))
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async getEntity(organizationId: string, clientId: string, entityId: string) {
    await this.getClient(organizationId, clientId);
    const sb = this.supabase();
    const { data, error } = await sb
      .from('client_entities')
      .select('*')
      .eq('id', entityId)
      .eq('client_id', clientId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Entity not found');
    }
    return data;
  }

  async updateEntity(
    organizationId: string,
    clientId: string,
    entityId: string,
    dto: UpdateClientEntityDto,
  ) {
    await this.getEntity(organizationId, clientId, entityId);
    const patch = this.entityPatchFromDto(dto);
    if (Object.keys(patch).length === 0) {
      return this.getEntity(organizationId, clientId, entityId);
    }

    const sb = this.supabase();
    const { data, error } = await sb
      .from('client_entities')
      .update(patch)
      .eq('id', entityId)
      .eq('client_id', clientId)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async deleteEntity(organizationId: string, clientId: string, entityId: string) {
    await this.getEntity(organizationId, clientId, entityId);
    const sb = this.supabase();
    const { error } = await sb
      .from('client_entities')
      .delete()
      .eq('id', entityId)
      .eq('client_id', clientId);

    if (error) {
      throw new BadRequestException(error.message);
    }
  }
}
