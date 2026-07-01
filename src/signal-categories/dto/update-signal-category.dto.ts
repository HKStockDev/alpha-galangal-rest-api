import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSignalCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;
}
