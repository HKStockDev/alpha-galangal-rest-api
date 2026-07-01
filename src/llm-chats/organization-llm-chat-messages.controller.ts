import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { BillingEntitlementGuard } from '../billing/guards/billing-entitlement.guard';
import { OrgMemberGuard } from '../organizations/guards/org-member.guard';
import {
  CreateOrganizationLlmMessageDto,
  ListOrganizationLlmMessagesQueryDto,
  UpdateOrganizationLlmMessageDto,
} from './dto';
import { LlmChatsService } from './llm-chats.service';

@Controller('organizations/:organizationId/llm-chats/:conversationId/messages')
@UseGuards(SupabaseAuthGuard, OrgMemberGuard, BillingEntitlementGuard)
export class OrganizationLlmChatMessagesController {
  constructor(private readonly llmChatsService: LlmChatsService) {}

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: { id: string },
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    query: ListOrganizationLlmMessagesQueryDto,
  ) {
    return this.llmChatsService.listMessages(
      organizationId,
      user.id,
      conversationId,
      query,
    );
  }

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateOrganizationLlmMessageDto,
  ) {
    return this.llmChatsService.createMessage(
      organizationId,
      user.id,
      conversationId,
      dto,
    );
  }

  @Patch(':messageId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateOrganizationLlmMessageDto,
  ) {
    return this.llmChatsService.updateMessage(
      organizationId,
      user.id,
      conversationId,
      messageId,
      dto,
    );
  }

  @Delete(':messageId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.llmChatsService.deleteMessage(
      organizationId,
      user.id,
      conversationId,
      messageId,
    );
  }
}
