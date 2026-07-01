import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class PatchEquityTagFilterDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  tag_ids!: string[];
}
