import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateWatchlistSecurityItemDto {
  @IsOptional()
  @IsInt()
  sort_order?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
