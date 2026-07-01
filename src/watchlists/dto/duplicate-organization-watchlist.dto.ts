import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DuplicateOrganizationWatchlistDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name?: string;

  /** When false, only the watchlist header is copied (no securities rows). Default: true */
  @IsOptional()
  @IsBoolean()
  include_securities?: boolean;
}
