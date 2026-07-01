import { Allow, IsUUID, ValidateIf } from 'class-validator';

export class ConvertWatchlistScopeDto {
  /**
   * Target scope: `null` = global (detach from client). UUID = attach / convert to that client.
   * Omitting this field is invalid; the service rejects undefined after validation.
   */
  @Allow()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID('4')
  organization_client_id?: string | null;
}
