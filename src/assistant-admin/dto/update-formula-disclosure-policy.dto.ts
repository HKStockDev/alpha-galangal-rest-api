import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateFormulaDisclosurePolicyDto {
  @IsOptional()
  @IsBoolean()
  block_exact_equation_for_system_formulas?: boolean;

  @IsOptional()
  @IsBoolean()
  allow_factor_names?: boolean;

  @IsOptional()
  @IsBoolean()
  allow_weights?: boolean;
}
