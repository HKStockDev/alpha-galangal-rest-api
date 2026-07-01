import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateFormulaMarketingReleaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  subtitle?: string | null;

  @IsOptional()
  @IsString()
  body?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  hero_image_url?: string | null;

  @IsOptional()
  @IsISO8601()
  as_of?: string;

  @IsOptional()
  @IsISO8601()
  published_at?: string | null;

  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @IsOptional()
  @IsObject()
  settings_json?: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  seo_title?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(1000)
  seo_description?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  seo_og_image_url?: string | null;
}
