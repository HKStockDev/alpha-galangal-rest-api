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
  CreateOrganizationLlmConversationDto,
  ListOrganizationLlmConversationsQueryDto,
  UpdateOrganizationLlmConversationDto,
} from './dto';
import { LlmChatsService } from './llm-chats.service';

@Controller('organizations/:organizationId/llm-chats')
@UseGuards(SupabaseAuthGuard, OrgMemberGuard, BillingEntitlementGuard)
export class OrganizationLlmChatsController {
  constructor(private readonly llmChatsService: LlmChatsService) {}

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    query: ListOrganizationLlmConversationsQueryDto,
  ) {
    return this.llmChatsService.listConversations(organizationId, user.id, query);
  }

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateOrganizationLlmConversationDto,
  ) {
    return this.llmChatsService.createConversation(organizationId, user.id, dto);
  }

  @Get(':conversationId')
  getOne(
    @Param('organizationId') organizationId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.llmChatsService.getOwnedConversation(
      organizationId,
      user.id,
      conversationId,
    );
  }

  @Patch(':conversationId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateOrganizationLlmConversationDto,
  ) {
    return this.llmChatsService.updateConversation(
      organizationId,
      user.id,
      conversationId,
      dto,
    );
  }

  @Delete(':conversationId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.llmChatsService.deleteConversation(
      organizationId,
      user.id,
      conversationId,
    );
  }
}
