import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CalculateLynchScoreDto {
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

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxScore?: number;
}
