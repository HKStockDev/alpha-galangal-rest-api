import { IsOptional, IsUUID } from 'class-validator';

export class ListFormulasMarketingQueryDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;
}
