import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListAdminCreditTransactionsQueryDto {
  @IsOptional()
  @IsString()
  organization_id?: string;

  @IsOptional()
  @IsString()
  tx_type?: string;

  @IsOptional()
  @IsString()
  bucket_type?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ListAdminCreditWalletsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  organization_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class UpdateCapabilityCreditCostDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  credits_cost!: number;

  @IsOptional()
  @IsBoolean()
  is_enabled?: boolean;
}

export class UpdateCreditPolicyDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pack_expiry_days?: number;

  @IsOptional()
  base_carryover_enabled?: boolean;

  @IsOptional()
  pack_carryover_until_expiry?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  carryover_cap_credits?: number | null;

  @IsOptional()
  @IsString()
  upgrade_proration_mode?: string;

  @IsOptional()
  @IsString()
  downgrade_effective_mode?: string;
}
