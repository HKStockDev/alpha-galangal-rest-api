import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

function parseOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : (value as number);
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value as boolean;
}

export class ListJobPostsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  isRemote?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  isExpired?: boolean;

  @IsOptional()
  @IsDateString()
  postedFrom?: string;

  @IsOptional()
  @IsDateString()
  postedTo?: string;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn(['posted_at', 'last_seen_at', 'company_name', 'title'])
  sortBy?: 'posted_at' | 'last_seen_at' | 'company_name' | 'title';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
