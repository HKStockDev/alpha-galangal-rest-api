import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListStripeEventsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'processed', 'failed'])
  status?: 'pending' | 'processed' | 'failed';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  event_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : 50))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
