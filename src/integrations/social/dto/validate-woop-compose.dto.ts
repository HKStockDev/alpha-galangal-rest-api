import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ValidateWoopComposeDto {
  @IsString()
  @MinLength(1)
  social_account_id!: string;

  @IsString()
  @MaxLength(4000)
  caption!: string;

  @IsOptional()
  @IsString()
  link_url?: string;

  @IsOptional()
  @IsString()
  post_kind?: string;

  @IsOptional()
  @IsObject()
  platform_inputs?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  media_ids?: string[];

  @IsOptional()
  @IsIn(['now', 'schedule', 'draft'])
  publish_mode?: 'now' | 'schedule' | 'draft';

  @IsOptional()
  @IsString()
  publish_at?: string;
}
