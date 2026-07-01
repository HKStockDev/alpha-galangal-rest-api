export class StockIngestFiltersResponseDto {
  exchanges!: string[];
  security_types!: string[];
  countries!: string[];
  min_market_cap_millions!: number | null;
  min_avg_share_volume_thousands!: number | null;
  min_price_usd!: number | null;
  min_avg_dollar_volume_millions!: number | null;
  updated_at!: string;
  updated_by!: string | null;
}
