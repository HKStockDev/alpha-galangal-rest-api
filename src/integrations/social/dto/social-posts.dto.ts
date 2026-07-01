import { IsArray, IsBoolean, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { MVP_PUBLISH_PLATFORMS } from '../social-org.util';

export class SocialPostPreviewDto {
  @IsString()
  @MaxLength(32)
  platform!: string;

  @IsUrl({ require_tld: false })
  link_url!: string;

  @IsString()
  @MaxLength(500)
  share_title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  share_summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  ticker?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization_name?: string;

  @IsOptional()
  @IsString()
  post_kind?: string;

  @IsOptional()
  @IsString()
  render_template_key?: string;

  @IsOptional()
  @IsString()
  organization_id?: string;
}

export class CreateSocialPostDto {
  @IsString()
  @MinLength(1)
  social_account_id!: string;

  @IsString()
  @MaxLength(4000)
  caption!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  link_url?: string;

  @IsOptional()
  @IsString()
  post_kind?: string;

  @IsOptional()
  @IsObject()
  prompt_params?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  organization_id?: string;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @IsOptional()
  @IsIn(['now', 'schedule', 'draft'])
  publish_mode?: 'now' | 'schedule' | 'draft';

  @IsOptional()
  @IsISO8601()
  publish_at?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  media_ids?: string[];
}

export class PublishSocialPostDto {
  @IsOptional()
  @IsString()
  organization_id?: string;
}
