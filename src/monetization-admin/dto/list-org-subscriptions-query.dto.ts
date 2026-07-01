import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListOrgSubscriptionsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
