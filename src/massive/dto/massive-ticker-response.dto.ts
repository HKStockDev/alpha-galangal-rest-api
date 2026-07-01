export interface MassiveTickerResultDto {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  active?: boolean;
  ticker_root?: string;
  ticker_suffix?: string;
  cik?: string;
  composite_figi?: string;
  share_class_figi?: string;
  type?: string;
  description?: string;
  homepage_url?: string;
  phone_number?: string;
  total_employees?: number;
  list_date?: string;
  primary_exchange?: string;
  currency_name?: string;
  sic_code?: string;
  sic_description?: string;
  market_cap?: number;
  share_class_shares_outstanding?: number;
  weighted_shares_outstanding?: number;
  round_lot?: number;
  delisted_utc?: string;
}

export interface MassiveTickerResponseDto {
  request_id?: string;
  results?: MassiveTickerResultDto;
  status?: string;
  count?: number;
}
