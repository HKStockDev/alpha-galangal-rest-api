import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const MULTI_FORMULA_SORT_COLUMNS = [
  'ticker',
  'fundamental_constriction_score',
  'net_exposure_score',
  'insider_conviction_score',
  'political_score',
  'america_first_score',
] as const;

export type MultiFormulaSortColumn = (typeof MULTI_FORMULA_SORT_COLUMNS)[number];

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseSortDir(value: unknown): 'asc' | 'desc' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const s = String(value).trim().toLowerCase();
  if (s === 'asc' || s === 'desc') return s;
  return undefined;
}

export class MultiFormulaScreenerQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  min_fundamental_constriction_score?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  max_fundamental_constriction_score?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  min_net_exposure_score?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  max_net_exposure_score?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  min_insider_conviction_score?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  max_insider_conviction_score?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  min_political_score?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  max_political_score?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  min_america_first_score?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value))
  max_america_first_score?: number;

  @IsOptional()
  @IsIn(MULTI_FORMULA_SORT_COLUMNS)
  sort_by?: MultiFormulaSortColumn;

  @IsOptional()
  @Transform(({ value }) => parseSortDir(value))
  @IsIn(['asc', 'desc'])
  sort_dir?: 'asc' | 'desc';
}
