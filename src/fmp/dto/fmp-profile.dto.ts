export interface FmpProfileDto {
  symbol?: string;
  companyName?: string;
  exchange?: string;
  exchangeShortName?: string;
  industry?: string;
  sector?: string;
  description?: string;
  ceo?: string;
  fullTimeEmployees?: number;
  employees?: number;
  country?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  website?: string;
  image?: string;
  ipoDate?: string;
  isEtf?: boolean;
  isFund?: boolean;
  isAdr?: boolean;
  cik?: string;
  isin?: string;
  cusip?: string;
  marketCap?: number;
  /** Last price from FMP profile (USD for US listings). */
  price?: number;
  /** Average daily volume in shares (FMP field volAvg). */
  volAvg?: number;
  currency?: string;
  [key: string]: unknown;
}
