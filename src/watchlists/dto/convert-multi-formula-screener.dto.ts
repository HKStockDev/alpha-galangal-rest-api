import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ConvertMultiFormulaScreenerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  organization_client_id?: string | null;
}
