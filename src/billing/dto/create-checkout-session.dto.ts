import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

/** Max seats aligned with marketing "up to 10 users" for Team tier. */
export const TEAM_PLAN_MAX_SEATS = 10;

export class CreateCheckoutSessionDto {
  @IsString()
  @IsNotEmpty()
  plan_key!: string;

  /** Required for per-seat plans; ignored for flat plans (quantity forced to 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(TEAM_PLAN_MAX_SEATS)
  seat_quantity?: number;

  /** CON-168: Stripe Checkout trial on TRIAL_ENTRY_PLAN_KEY (card collected on Stripe hosted page). */
  @IsOptional()
  @IsBoolean()
  start_trial?: boolean;
}
