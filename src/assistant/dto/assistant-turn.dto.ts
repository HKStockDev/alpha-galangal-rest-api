import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class AssistantTurnDto {
  @ValidateIf((o: AssistantTurnDto) => !o.confirm_action_id && !o.reject_action_id)
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  content?: string;

  @IsOptional()
  @IsUUID()
  confirm_action_id?: string;

  @IsOptional()
  @IsUUID()
  reject_action_id?: string;
}
