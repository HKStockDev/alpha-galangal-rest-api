import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class SocialOauthExchangeDto {
  @IsString()
  @MinLength(10)
  code!: string;

  @IsString()
  @MinLength(8)
  state!: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  redirect_uri?: string;
}
