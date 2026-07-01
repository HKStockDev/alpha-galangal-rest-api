import { IsFQDN, IsOptional } from 'class-validator';

export class EnrichOrganizationDto {
  @IsOptional()
  @IsFQDN({ require_tld: true })
  domain?: string;
}
