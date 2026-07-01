import { IsUUID } from 'class-validator';

export class SocialOauthRefreshDto {
  @IsUUID()
  social_account_id!: string;
}
