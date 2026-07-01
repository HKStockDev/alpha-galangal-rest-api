import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { CLIENT_TYPES, ClientType } from '../client-enums';

export class CreateOrganizationClientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name!: string;

  @IsIn(CLIENT_TYPES as unknown as string[])
  client_type!: ClientType;
}
