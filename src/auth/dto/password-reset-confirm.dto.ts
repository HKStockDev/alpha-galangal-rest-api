import { IsString, MaxLength, MinLength } from 'class-validator';

export class PasswordResetConfirmDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  new_password!: string;

  @IsString()
  @MinLength(1)
  token!: string;
}
