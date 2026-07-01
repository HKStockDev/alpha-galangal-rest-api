import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CLIENT_AML_RISK_LEVELS,
  CLIENT_ENTITY_TYPES,
  CLIENT_KYC_STATUSES,
  CLIENT_ONBOARDING_STATUSES,
  CLIENT_STATUSES,
  ClientAmlRiskLevel,
  ClientEntityType,
  ClientKycStatus,
  ClientOnboardingStatus,
  ClientStatus,
  INVESTMENT_OBJECTIVES,
  InvestmentObjective,
  LIQUIDITY_NEEDS,
  LiquidityNeeds,
  RELATIONSHIP_ROLES,
  RelationshipRole,
  SPECIAL_PREFERENCE_TAGS,
  SpecialPreferenceTag,
  TAX_ACCOUNT_TYPES,
  TaxAccountType,
  TIME_HORIZONS,
  TimeHorizon,
} from '../client-enums';

export class UpdateClientEntityDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  display_name?: string;

  @IsOptional()
  @IsIn(CLIENT_ENTITY_TYPES as unknown as string[])
  entity_type?: ClientEntityType | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  legal_name?: string | null;

  @IsOptional()
  @IsDateString()
  date_of_birth?: string | null;

  @IsOptional()
  @IsDateString()
  incorporation_date?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tax_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  national_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  passport_no?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country_of_residence?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country_of_incorporation?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tax_residency?: string | null;

  @IsOptional()
  @IsIn(CLIENT_KYC_STATUSES as unknown as string[])
  kyc_status?: ClientKycStatus | null;

  @IsOptional()
  @IsDateString()
  kyc_verified_at?: string | null;

  @IsOptional()
  @IsIn(CLIENT_AML_RISK_LEVELS as unknown as string[])
  aml_risk_level?: ClientAmlRiskLevel | null;

  @IsOptional()
  @IsBoolean()
  pep_flag?: boolean;

  @IsOptional()
  @IsBoolean()
  sanctions_flag?: boolean;

  @IsOptional()
  @IsUUID()
  parent_entity_id?: string | null;

  @IsOptional()
  @IsUUID()
  beneficial_owner_of?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ownership_percent?: number | null;

  @IsOptional()
  @IsIn(CLIENT_ONBOARDING_STATUSES as unknown as string[])
  onboarding_status?: ClientOnboardingStatus | null;

  @IsOptional()
  @IsIn(CLIENT_STATUSES as unknown as string[])
  client_status?: ClientStatus | null;

  @IsOptional()
  @IsDateString()
  closed_at?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  closure_reason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source_system?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source_system_id?: string | null;

  @IsOptional()
  @IsUUID()
  created_by?: string | null;

  @IsOptional()
  @IsUUID()
  updated_by?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number | null;

  @IsOptional()
  @IsIn(RELATIONSHIP_ROLES as unknown as string[])
  relationship_role?: RelationshipRole | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  relationship_role_other?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  risk_score?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  risk_notes?: string | null;

  @IsOptional()
  @IsIn(TIME_HORIZONS as unknown as string[])
  time_horizon_category?: TimeHorizon | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  time_horizon_detail?: string | null;

  @IsOptional()
  @IsArray()
  @IsIn(INVESTMENT_OBJECTIVES as unknown as string[], { each: true })
  investment_objectives?: InvestmentObjective[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  investment_objectives_notes?: string | null;

  @IsOptional()
  @IsIn(LIQUIDITY_NEEDS as unknown as string[])
  liquidity_needs?: LiquidityNeeds | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  liquidity_notes?: string | null;

  @IsOptional()
  @IsArray()
  @IsIn(TAX_ACCOUNT_TYPES as unknown as string[], { each: true })
  tax_account_types?: TaxAccountType[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  tax_account_notes?: string | null;

  @IsOptional()
  @IsArray()
  @IsIn(SPECIAL_PREFERENCE_TAGS as unknown as string[], { each: true })
  special_preferences_tags?: SpecialPreferenceTag[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  special_preferences_notes?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(130)
  age?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  life_stage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string | null;

  @IsOptional()
  @IsObject()
  settings_json?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  display_order?: number | null;
}
