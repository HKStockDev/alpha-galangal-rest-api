import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { TEAM_PLAN_MAX_SEATS } from './create-checkout-session.dto';

export class ChangeSubscriptionPlanDto {
  @IsString()
  @IsNotEmpty()
  plan_key!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(TEAM_PLAN_MAX_SEATS)
  seat_quantity?: number;
}
