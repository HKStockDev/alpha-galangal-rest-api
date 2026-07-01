import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { AssistantAdminService } from './assistant-admin.service';
import { ListGovernanceQueryDto } from './dto/list-governance-query.dto';
import { UpdateFactorGovernanceDto } from './dto/update-factor-governance.dto';
import { UpdateFormulaDisclosurePolicyDto } from './dto/update-formula-disclosure-policy.dto';
import { UpdateFormulaGovernanceDto } from './dto/update-formula-governance.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';

@Controller('admin/ai-assistant')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class AssistantAdminController {
  constructor(private readonly assistantAdmin: AssistantAdminService) {}

  @Get('prompt-templates')
  listPromptTemplates() {
    return this.assistantAdmin.listPromptTemplates();
  }

  @Patch('prompt-templates/:id')
  updatePromptTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromptTemplateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.assistantAdmin.updatePromptTemplate(id, dto, user.id);
  }

  @Get('formula-disclosure-policy')
  getFormulaDisclosurePolicy() {
    return this.assistantAdmin.getFormulaDisclosurePolicy();
  }

  @Patch('formula-disclosure-policy')
  updateFormulaDisclosurePolicy(
    @Body() dto: UpdateFormulaDisclosurePolicyDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.assistantAdmin.updateFormulaDisclosurePolicy(dto, user.id);
  }

  @Get('core-config')
  getCoreConfig() {
    return this.assistantAdmin.getAssistantCoreConfig();
  }

  @Get('scope-policy')
  getScopePolicy() {
    return this.assistantAdmin.getScopePolicy();
  }

  @Get('formulas/governance')
  listFormulasGovernance(@Query() query: ListGovernanceQueryDto) {
    return this.assistantAdmin.listFormulasGovernance(query);
  }

  @Patch('formulas/:formulaId/governance')
  updateFormulaGovernance(
    @Param('formulaId', ParseUUIDPipe) formulaId: string,
    @Body() dto: UpdateFormulaGovernanceDto,
  ) {
    return this.assistantAdmin.updateFormulaGovernance(formulaId, dto);
  }

  @Get('factors/governance')
  listFactorsGovernance(@Query() query: ListGovernanceQueryDto) {
    return this.assistantAdmin.listFactorsGovernance(query);
  }

  @Patch('factors/:factorId/governance')
  updateFactorGovernance(
    @Param('factorId', ParseUUIDPipe) factorId: string,
    @Body() dto: UpdateFactorGovernanceDto,
  ) {
    return this.assistantAdmin.updateFactorGovernance(factorId, dto);
  }
}
