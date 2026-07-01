import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { BillingEntitlementGuard } from '../billing/guards/billing-entitlement.guard';
import { TestLogService } from '../common/test-log.service';
import { OrgMemberGuard } from '../organizations/guards/org-member.guard';
import { AssistantService } from './assistant.service';
import { AssistantTurnDto } from './dto/assistant-turn.dto';

@Controller('organizations/:organizationId/llm-chats/:conversationId')
@UseGuards(SupabaseAuthGuard, OrgMemberGuard, BillingEntitlementGuard)
export class OrganizationAssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly testLog: TestLogService,
  ) {}

  @Post('assistant-turn')
  assistantTurn(
    @Param('organizationId') organizationId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AssistantTurnDto,
  ) {
    this.testLog.log('OrganizationAssistantController.assistantTurn', 'request', {
      organizationId,
      conversationId,
      userId: user.id,
      content: dto.content,
      confirmActionId: dto.confirm_action_id,
      rejectActionId: dto.reject_action_id,
    });

    return this.assistant.runAssistantTurn(organizationId, user.id, conversationId, {
      content: dto.content,
      confirmActionId: dto.confirm_action_id,
      rejectActionId: dto.reject_action_id,
    });
  }
}
