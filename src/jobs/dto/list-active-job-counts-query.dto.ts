import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

function parseOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : (value as number);
}

/**
 * Query for `GET /jobs/active-entity-securities/job-counts`. Matches the shape of
 * `ListActiveEmployeeOverviewQueryDto` minus the per-id filter (this admin page
 * always lists the full active-entity universe).
 */
export class ListActiveJobCountsQueryDto {
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
}
