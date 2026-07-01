import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CalculateFundamentalConstrictionDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tickers?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  limit?: number;
}
