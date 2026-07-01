import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';

const ORIGINS = ['system', 'organization'] as const;
const VIS = ['hidden', 'owner_only', 'public'] as const;

export class UpdateFormulaGovernanceDto {
  @IsOptional()
  @IsIn([...ORIGINS])
  formula_origin?: (typeof ORIGINS)[number];

  @IsOptional()
  @IsIn([...VIS])
  equation_visibility_mode?: (typeof VIS)[number];

  @IsOptional()
  @IsBoolean()
  is_locked?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  source_formula_id?: string | null;
}
