export const ALLOWED_STOCK_EXCHANGES = [
  'NYSE',
  'NASDAQ',
  'AMEX',
  'OTC',
] as const;

export type AllowedStockExchange = (typeof ALLOWED_STOCK_EXCHANGES)[number];

export const ALLOWED_INGEST_SECURITY_TYPES = [
  'COMMON_STOCK',
  'ETF',
  'REIT',
  'SPAC',
  'ADR',
  'PREFERRED',
  'WARRANT',
  'UNIT',
  'CLOSED_END_FUND',
  'MUTUAL_FUND',
  'INDEX',
  'CRYPTO',
] as const;

export type IngestSecurityType = (typeof ALLOWED_INGEST_SECURITY_TYPES)[number];

export const ALLOWED_INGEST_COUNTRIES = [
  'USA',
  'Canada',
  'UK',
  'Germany',
  'China',
  'Japan',
  'Australia',
] as const;

export type AllowedIngestCountry = (typeof ALLOWED_INGEST_COUNTRIES)[number];
