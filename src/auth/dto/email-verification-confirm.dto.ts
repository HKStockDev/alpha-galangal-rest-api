import { IsIn, IsNotEmpty, IsString } from 'class-validator';

const EMAIL_OTP_TYPES = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
] as const;

export class EmailVerificationConfirmDto {
  @IsString()
  @IsNotEmpty()
  token_hash!: string;

  @IsString()
  @IsIn(EMAIL_OTP_TYPES)
  type!: (typeof EMAIL_OTP_TYPES)[number];
}
