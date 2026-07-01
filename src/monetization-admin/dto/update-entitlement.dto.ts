import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateEntitlementDto {
  @IsBoolean()
  is_enabled!: boolean;

  @IsOptional()
  @IsBoolean()
  hard_block?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['day', 'month', 'lifetime'])
  quota_period?: 'day' | 'month' | 'lifetime' | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  quota_limit?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  upsell_message?: string | null;
}
