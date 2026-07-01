import { IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';

export class SocialOauthAuthorizeQueryDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  redirect_uri?: string;
}
