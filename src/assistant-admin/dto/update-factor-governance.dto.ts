import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';

const ORIGINS = ['system', 'organization'] as const;
const VIS = ['hidden', 'organization', 'public'] as const;

export class UpdateFactorGovernanceDto {
  @IsOptional()
  @IsIn([...ORIGINS])
  factor_origin?: (typeof ORIGINS)[number];

  @IsOptional()
  @IsIn([...VIS])
  factor_visibility_mode?: (typeof VIS)[number];

  @IsOptional()
  @IsBoolean()
  is_locked?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  source_factor_id?: string | null;
}
