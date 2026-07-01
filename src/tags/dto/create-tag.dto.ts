import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(SLUG_REGEX, { message: 'slug must be lowercase alphanumeric and hyphens only' })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  group!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_llm_assignable?: boolean;

  @IsOptional()
  @IsNumber()
  sort_order?: number | null;

  @IsOptional()
  @IsNumber()
  weight_hint?: number | null;

  /** When omitted, the default organization (slug `default-organization`) is used. */
  @IsOptional()
  @IsUUID()
  organization_id?: string;
}
