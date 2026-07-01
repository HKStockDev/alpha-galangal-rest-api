import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCreditPackCheckoutDto {
  @IsString()
  @IsNotEmpty()
  pack_key!: string;
}
