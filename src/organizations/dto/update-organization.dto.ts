import {
  IsFQDN,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ORG_TYPES = ['ria', 'research_firm', 'hedge_fund', 'family_office', 'asset_manager'] as const;
const STATUSES = ['active', 'trial', 'suspended'] as const;

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(SLUG_REGEX, { message: 'slug must be lowercase alphanumeric and hyphens only' })
  slug?: string;

  @IsOptional()
  @IsIn(ORG_TYPES)
  organization_type?: (typeof ORG_TYPES)[number];

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsObject()
  settings_json?: Record<string, unknown>;

  @IsOptional()
  @IsFQDN({ require_tld: true })
  domain?: string;
}
