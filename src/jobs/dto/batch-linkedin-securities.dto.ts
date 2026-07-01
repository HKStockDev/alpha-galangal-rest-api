import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsUUID,
} from 'class-validator';

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value as boolean;
}

/** Body for step 1: batch resolve LinkedIn company URLs (s-r company finder). */
export class BatchLinkedinSecuritiesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one security_id is required.' })
  @ArrayMaxSize(100, { message: 'Maximum 100 securities per batch.' })
  @IsUUID(4, { each: true })
  securityIds!: string[];

  /**
   * Optional per-security domain for the s-r company finder (e.g. { "...uuid": "apple.com" }).
   * Key is `securityId`. Used when that row has no stored LinkedIn URL and you want to override FMP `homepage` domain.
   */
  @IsOptional()
  @IsObject()
  domainOverrideBySecurityId?: Record<string, string>;

  @IsOptional()
  @IsIn(['stocks', 'crypto', 'fx', 'indices', 'options'])
  market?: 'stocks' | 'crypto' | 'fx' | 'indices' | 'options';

  @IsOptional()
  @IsIn(['us', 'global'])
  locale?: 'us' | 'global';
}

/** Body for step 2: batch logical + riceman headcount scrapers. */
export class BatchLinkedinHeadcountDto extends BatchLinkedinSecuritiesDto {
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  getCompanyInsights?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  getTotalJobOpenings?: boolean;
}
