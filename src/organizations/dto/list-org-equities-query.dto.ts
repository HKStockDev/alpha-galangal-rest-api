import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const CYCLE_HORIZONS = ['1m', '3m', '6m', '12m', '24m'] as const;
const CYCLE_VALUES = [-1, 0, 1] as const;

function parseCycleIntArray(value: unknown): number[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const toInts = (parts: string[]): number[] => {
    const out: number[] = [];
    for (const p of parts) {
      const t = p.trim();
      if (!t) continue;
      const n = parseInt(t, 10);
      if (Number.isNaN(n)) continue;
      if ((CYCLE_VALUES as readonly number[]).includes(n)) {
        out.push(n);
      }
    }
    return out;
  };
  if (Array.isArray(value)) {
    return toInts(value.map((v) => String(v)));
  }
  if (typeof value === 'string') {
    return toInts(value.split(','));
  }
  return undefined;
}

export class ListOrgEquitiesQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    return s === 'true' || s === '1';
  })
  @IsBoolean()
  from_securities?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    return s === 'true' || s === '1';
  })
  @IsBoolean()
  only_with_entity?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
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

  /** Default 24m in service when omitted (SKE-43). Accepts 1m, 3m, 6m, 12m, 24m (case-insensitive). */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return String(value).trim().toLowerCase();
  })
  @IsIn([...CYCLE_HORIZONS])
  cycle_horizon?: string;

  /** Each value -1 (down), 0 (neutral), 1 (up). Comma-separated or repeated query keys. */
  @IsOptional()
  @Transform(({ value }) => parseCycleIntArray(value))
  @IsArray()
  @ArrayMaxSize(3)
  @IsInt({ each: true })
  @IsIn([-1, 0, 1], { each: true })
  sector_cycles?: number[];

  @IsOptional()
  @Transform(({ value }) => parseCycleIntArray(value))
  @IsArray()
  @ArrayMaxSize(3)
  @IsInt({ each: true })
  @IsIn([-1, 0, 1], { each: true })
  industry_cycles?: number[];

  @IsOptional()
  @Transform(({ value }) => parseCycleIntArray(value))
  @IsArray()
  @ArrayMaxSize(3)
  @IsInt({ each: true })
  @IsIn([-1, 0, 1], { each: true })
  sub_industry_cycles?: number[];
}
