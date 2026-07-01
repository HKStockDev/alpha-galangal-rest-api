import { IsOptional, IsUUID } from 'class-validator';

export class BulkEnableReadonlyDto {
  @IsOptional()
  @IsUUID()
  plan_id?: string;
}
