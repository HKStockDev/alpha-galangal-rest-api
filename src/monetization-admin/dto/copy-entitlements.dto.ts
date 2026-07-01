import { IsUUID } from 'class-validator';

export class CopyEntitlementsDto {
  @IsUUID()
  source_plan_id!: string;

  @IsUUID()
  target_plan_id!: string;
}
