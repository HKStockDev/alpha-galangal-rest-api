import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class ReleaseRowItemDto {
  @IsUUID()
  entity_id!: string;

  @IsOptional()
  @IsNumber()
  rank?: number | null;

  @IsNumber()
  score!: number;

  @IsOptional()
  @IsObject()
  explanation?: Record<string, unknown> | null;
}

export class ReplaceReleaseRowsDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => ReleaseRowItemDto)
  rows!: ReleaseRowItemDto[];
}
