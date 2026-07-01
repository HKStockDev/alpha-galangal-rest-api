import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class NetExposureDirectionWeightsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  beneficiary?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  supplier?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customer?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dependent?: number;
}

export class CalculateNetExposureScoreDto {
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

  @IsOptional()
  @ValidateNested()
  @Type(() => NetExposureDirectionWeightsDto)
  directionWeights?: NetExposureDirectionWeightsDto;
}
