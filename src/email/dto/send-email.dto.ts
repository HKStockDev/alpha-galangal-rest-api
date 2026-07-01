import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  @MaxLength(500)
  subject!: string;

  @IsString()
  html!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  from?: string;

  @IsOptional()
  @IsString()
  text?: string;
}
