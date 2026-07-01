import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import {
  ALLOWED_INGEST_COUNTRIES,
  ALLOWED_INGEST_SECURITY_TYPES,
  ALLOWED_STOCK_EXCHANGES,
} from '../ingest-filter.constants';

const EX_LIST = [...ALLOWED_STOCK_EXCHANGES] as string[];
const ST_LIST = [...ALLOWED_INGEST_SECURITY_TYPES] as string[];
const CT_LIST = [...ALLOWED_INGEST_COUNTRIES] as string[];

/** Partial update: omitted keys keep previous values; use null to clear numeric thresholds. */
export class PatchStockIngestFiltersDto {
  @IsOptional()
  @IsArray()
  @IsIn(EX_LIST, { each: true })
  exchanges?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(ST_LIST, { each: true })
  security_types?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(CT_LIST, { each: true })
  countries?: string[];

  /** Minimum market cap in millions of USD (e.g. 100 = $100M). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  min_market_cap_millions?: number | null;

  /** Minimum average daily volume in thousands of shares (e.g. 500 = 500,000 shares). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  min_avg_share_volume_thousands?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_price_usd?: number | null;

  /** Minimum average daily dollar volume in millions of USD. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  min_avg_dollar_volume_millions?: number | null;
}
