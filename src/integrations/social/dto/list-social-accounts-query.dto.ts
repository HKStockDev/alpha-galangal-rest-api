import { IsOptional, IsUUID } from 'class-validator';

export class ListSocialAccountsQueryDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;
}
