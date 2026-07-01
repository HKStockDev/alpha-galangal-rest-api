import { IsBoolean, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateFormulaMarketingReleaseDto {
  @IsUUID()
  formula_id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

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

  @IsISO8601()
  as_of!: string;

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
  @IsString()
  @MaxLength(200)
  seo_title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  seo_description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  seo_og_image_url?: string | null;
}
