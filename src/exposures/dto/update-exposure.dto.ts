import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class UpdateExposureDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(SLUG_REGEX, { message: 'slug must be lowercase alphanumeric and hyphens only' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsIn([-1, 0, 1])
  polarity?: number | null;
}
