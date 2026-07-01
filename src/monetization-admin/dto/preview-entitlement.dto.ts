import { IsString, IsUUID, MinLength } from 'class-validator';

export class PreviewEntitlementDto {
  @IsUUID()
  plan_id!: string;

  @IsString()
  @MinLength(1)
  capability_key!: string;
}
