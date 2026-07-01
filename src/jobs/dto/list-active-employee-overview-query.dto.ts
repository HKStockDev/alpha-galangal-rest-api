import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, ArrayMaxSize, ArrayMinSize } from 'class-validator';

function parseOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : (value as number);
}

/** Comma-separated UUIDs, e.g. from ?ids=uuid,uuid — parsed to array. */
function parseIdList(value: unknown): string[] | undefined {
  if (value == null || value === '' || (typeof value === 'string' && value.trim() === '')) return undefined;
  if (Array.isArray(value)) {
    return value.flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

export class ListActiveEmployeeOverviewQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['stocks', 'crypto', 'fx', 'indices', 'options'])
  market?: 'stocks' | 'crypto' | 'fx' | 'indices' | 'options';

  @IsOptional()
  @IsIn(['us', 'global'])
  locale?: 'us' | 'global';

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

  /** Comma-separated security UUIDs; filters to that subset of the active-entity list. */
  @IsOptional()
  @Transform(({ value }) => parseIdList(value))
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID(4, { each: true })
  ids?: string[];
}
