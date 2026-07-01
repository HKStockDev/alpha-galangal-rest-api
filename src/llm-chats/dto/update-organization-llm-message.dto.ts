import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { LLM_CHAT_MESSAGE_ROLES, LlmChatMessageRole } from '../llm-chat-message-roles';

export class UpdateOrganizationLlmMessageDto {
  @IsOptional()
  @IsIn(LLM_CHAT_MESSAGE_ROLES as unknown as string[])
  role?: LlmChatMessageRole;

  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  content?: string;

  @IsOptional()
  @IsObject()
  metadata_json?: Record<string, unknown>;
}
