import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { FormulaMarketingModule } from '../formula-marketing/formula-marketing.module';
import { OrgAdminGuard } from './guards/org-admin.guard';
import { OrgMemberGuard } from './guards/org-member.guard';
import { InvitationEmailService } from './invitations/invitation-email.service';
import { InvitationsController } from './invitations/invitations.controller';
import { OrganizationInvitationsController } from './invitations/organization-invitations.controller';
import { OrganizationInvitationsService } from './invitations/organization-invitations.service';
import { ApolloOrganizationEnrichmentService } from './apollo-organization-enrichment.service';
import { OrganizationEquitiesService } from './organization-equities.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [AuthModule, FormulaMarketingModule, forwardRef(() => BillingModule)],
  controllers: [
    OrganizationsController,
    OrganizationInvitationsController,
    InvitationsController,
  ],
  providers: [
    OrganizationEquitiesService,
    OrganizationsService,
    ApolloOrganizationEnrichmentService,
    OrgAdminGuard,
    OrgMemberGuard,
    OrganizationInvitationsService,
    InvitationEmailService,
  ],
  exports: [OrganizationsService, OrganizationEquitiesService, OrgAdminGuard, OrgMemberGuard],
})
export class OrganizationsModule {}
