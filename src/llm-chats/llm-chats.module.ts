import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { CreditsModule } from '../credits/credits.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LlmChatsService } from './llm-chats.service';
import { OrganizationLlmChatMessagesController } from './organization-llm-chat-messages.controller';
import { OrganizationLlmChatsController } from './organization-llm-chats.controller';

@Module({
  imports: [AuthModule, OrganizationsModule, BillingModule, CreditsModule],
  controllers: [OrganizationLlmChatsController, OrganizationLlmChatMessagesController],
  providers: [LlmChatsService],
  exports: [LlmChatsService],
})
export class LlmChatsModule {}
