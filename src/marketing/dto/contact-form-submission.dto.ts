import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ContactFormSubmissionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  firm!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  role!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(10000)
  message!: string;
}
