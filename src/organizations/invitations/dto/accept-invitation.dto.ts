import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token!: string;
}
