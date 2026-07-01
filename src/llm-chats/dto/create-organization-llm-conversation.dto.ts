import { IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateOrganizationLlmConversationDto {
  @IsOptional()
  @IsUUID()
  organization_client_id?: string | null;

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
