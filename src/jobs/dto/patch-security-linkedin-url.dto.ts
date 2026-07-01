import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Empty string or null clears the URL. */
export class PatchSecurityLinkedinUrlDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  linkedinCompanyUrl?: string | null;
}
