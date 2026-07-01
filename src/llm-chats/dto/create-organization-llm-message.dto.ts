import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { LLM_CHAT_MESSAGE_ROLES, LlmChatMessageRole } from '../llm-chat-message-roles';

export class CreateOrganizationLlmMessageDto {
  @IsIn(LLM_CHAT_MESSAGE_ROLES as unknown as string[])
  role!: LlmChatMessageRole;

  @IsString()
  @MaxLength(500_000)
  content!: string;

  @IsOptional()
  @IsObject()
  metadata_json?: Record<string, unknown>;
}
