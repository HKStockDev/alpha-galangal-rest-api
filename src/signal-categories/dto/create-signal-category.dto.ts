import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSignalCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;
}
