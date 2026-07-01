import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value as boolean;
}

/**
 * Riceman actor add-ons (paid per Apify). Defaults true when omitted.
 * @see https://apify.com/riceman/linkedin-company-data-insights-scraper
 */
export class RefreshLinkedinHeadcountDto {
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  getCompanyInsights?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  getTotalJobOpenings?: boolean;

  /**
   * When true (default) and `linkedinCompanyUrl` is not set, call s-r/company-finder on domain from FMP `homepage_url` (or `domainOverride`).
   */
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  resolveLinkedInFromDomain?: boolean;

  /** Optional e.g. `microsoft.com` — used instead of deriving from homepage when no LinkedIn URL is stored. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  domainOverride?: string;
}
