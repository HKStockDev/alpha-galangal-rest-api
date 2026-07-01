import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

const VIS = ['organization', 'private', 'public'] as const;

export class UpdateFormulaMarketingDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  hero_image_url?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  marketing_slug?: string | null;

  @IsOptional()
  @IsObject()
  marketing_settings?: Record<string, unknown>;

  @IsOptional()
  @IsIn([...VIS])
  visibility?: (typeof VIS)[number];

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  next_release_at?: string | null;

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
