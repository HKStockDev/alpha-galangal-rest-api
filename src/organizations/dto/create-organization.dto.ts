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

export class CreateOrganizationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(SLUG_REGEX, { message: 'slug must be lowercase alphanumeric and hyphens only' })
  slug!: string;

  @IsIn(ORG_TYPES)
  organization_type!: (typeof ORG_TYPES)[number];

  @IsOptional()
  @IsObject()
  settings_json?: Record<string, unknown>;

  @IsOptional()
  @IsFQDN({ require_tld: true })
  enrichment_domain?: string;
}
