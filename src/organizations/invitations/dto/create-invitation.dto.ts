import { IsEmail, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsIn(['org_admin', 'org_member'])
  role!: 'org_admin' | 'org_member';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
