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
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { OrgAdminGuard } from './guards/org-admin.guard';
import { OrgMemberGuard } from './guards/org-member.guard';
import { FormulaMarketingService } from '../formula-marketing/formula-marketing.service';
import { OrganizationEquitiesService } from './organization-equities.service';
import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationDto,
  EnrichOrganizationDto,
  ListOrgEquitiesQueryDto,
  PatchEquityTagFilterDto,
  UpdateOrganizationDto,
  UpdateOrganizationMembershipDto,
} from './dto';

@Controller('organizations')
@UseGuards(SupabaseAuthGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly organizationEquitiesService: OrganizationEquitiesService,
    private readonly formulaMarketingService: FormulaMarketingService,
  ) {}

  @Get('me')
  async listMyOrganizations(@CurrentUser() user: { id: string; email: string }) {
    return this.organizationsService.listMyOrganizations(user.id);
  }

  @Get('slug-available/:slug')
  async slugAvailable(@Param('slug') slug: string) {
    return this.organizationsService.checkSlugAvailability(slug);
  }

  @Post(':organizationId/enrich')
  @UseGuards(OrgAdminGuard)
  async enrich(
    @Param('organizationId') organizationId: string,
    @Body() dto: EnrichOrganizationDto,
  ) {
    return this.organizationsService.enrichFromApollo(organizationId, dto);
  }

  @Get(':organizationId/equity-tags')
  @UseGuards(OrgMemberGuard)
  async listEquityTagOptions(@Param('organizationId') organizationId: string) {
    return this.organizationEquitiesService.listPickableTags(organizationId);
  }

  @Get(':organizationId/equities')
  @UseGuards(OrgMemberGuard)
  async listOrgEquities(
    @Param('organizationId') organizationId: string,
    @Query() query: ListOrgEquitiesQueryDto,
  ) {
    return this.organizationEquitiesService.listEquities(organizationId, query);
  }

  @Get(':organizationId/equities/:securityId')
  @UseGuards(OrgMemberGuard)
  async getOrgEquityDetails(
    @Param('organizationId') organizationId: string,
    @Param('securityId') securityId: string,
  ) {
    return this.organizationEquitiesService.getEquityDetails(organizationId, securityId);
  }

  /** CON-112: marketing cards for org dashboard (hero, description, visibility, etc.). */
  @Get(':organizationId/formulas/marketing')
  @UseGuards(OrgMemberGuard)
  async listOrgFormulaMarketing(@Param('organizationId') organizationId: string) {
    return this.formulaMarketingService.listFormulas(organizationId);
  }

  @Get(':organizationId/equity-tag-filter')
  @UseGuards(OrgMemberGuard)
  async getEquityTagFilter(@Param('organizationId') organizationId: string) {
    return this.organizationEquitiesService.getEquityTagFilter(organizationId);
  }

  @Patch(':organizationId/equity-tag-filter')
  @UseGuards(OrgAdminGuard)
  async patchEquityTagFilter(
    @Param('organizationId') organizationId: string,
    @Body() dto: PatchEquityTagFilterDto,
  ) {
    return this.organizationEquitiesService.setEquityTagFilter(organizationId, dto.tag_ids);
  }

  @Get(':organizationId')
  @UseGuards(OrgMemberGuard)
  async getOne(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string; email: string },
  ) {
    return this.organizationsService.getOne(organizationId, user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: { id: string; email: string },
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(user.id, dto);
  }

  @Patch(':organizationId')
  @UseGuards(OrgAdminGuard)
  async update(
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(organizationId, dto);
  }

  @Get(':organizationId/memberships')
  @UseGuards(OrgMemberGuard)
  async listMemberships(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string; email: string },
  ) {
    return this.organizationsService.listMemberships(organizationId, user.id);
  }

  @Patch(':organizationId/memberships/:membershipId')
  @UseGuards(OrgAdminGuard)
  async updateMembership(
    @Param('organizationId') organizationId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateOrganizationMembershipDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.organizationsService.updateMembership(
      organizationId,
      membershipId,
      dto,
      user.id,
    );
  }

  @Delete(':organizationId/memberships/:membershipId')
  @UseGuards(OrgAdminGuard)
  async removeMembership(
    @Param('organizationId') organizationId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.organizationsService.removeMembership(
      organizationId,
      membershipId,
      user.id,
    );
  }
}
