import { IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AddWatchlistSecurityDto {
  @IsUUID()
  security_id!: string;

  @IsOptional()
  @IsInt()
  sort_order?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
