import { IsIn, IsOptional } from 'class-validator';

const ROLES = ['org_admin', 'org_member'] as const;
const STATUSES = ['active', 'invited', 'disabled'] as const;

export class UpdateOrganizationMembershipDto {
  @IsOptional()
  @IsIn(ROLES)
  role?: (typeof ROLES)[number];

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}
