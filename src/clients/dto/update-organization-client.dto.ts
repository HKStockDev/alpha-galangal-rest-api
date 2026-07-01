import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CLIENT_TYPES, ClientType } from '../client-enums';

export class UpdateOrganizationClientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsIn(CLIENT_TYPES as unknown as string[])
  client_type?: ClientType;
}
