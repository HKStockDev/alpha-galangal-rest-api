import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdatePromptTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  template_text?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  change_note?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
