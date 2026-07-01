import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListCreditTransactionsQueryDto {
  @IsOptional()
  @IsIn(['purchase', 'consume', 'refund', 'adjust', 'expire', 'base_grant', 'base_reset'])
  tx_type?: string;

  @IsOptional()
  @IsIn(['base', 'pack'])
  bucket_type?: string;

  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : 50))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : 0))
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
