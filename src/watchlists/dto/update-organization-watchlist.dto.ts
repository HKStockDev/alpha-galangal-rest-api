import { IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateOrganizationWatchlistDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  sort_order?: number | null;

  @IsOptional()
  @IsObject()
  metadata_json?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  source_organization_llm_conversation_id?: string | null;
}
