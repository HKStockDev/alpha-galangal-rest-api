import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationLlmConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model_key?: string | null;

  @IsOptional()
  @IsObject()
  metadata_json?: Record<string, unknown>;
}
