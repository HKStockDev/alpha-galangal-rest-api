import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import type { DataSyncJobSchedule, SyncScheduleFrequency } from '../data-sync.types';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateSyncScheduleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['hourly', 'daily', 'weekly', 'monthly'])
  frequency?: SyncScheduleFrequency;

  @IsOptional()
  @IsString()
  timezone?: string;

  @ValidateIf((o: UpdateSyncScheduleDto) => o.frequency === 'hourly')
  @IsInt()
  @Min(1)
  @Max(24)
  hourly_interval_hours?: number;

  @ValidateIf((o: UpdateSyncScheduleDto) => o.frequency === 'hourly')
  @IsString()
  @Matches(TIME_PATTERN)
  hourly_start_time?: string;

  @IsOptional()
  @IsBoolean()
  market_days_only?: boolean;

  @ValidateIf((o: UpdateSyncScheduleDto) => o.frequency === 'daily')
  @IsString()
  @Matches(TIME_PATTERN)
  daily_time?: string;

  @ValidateIf((o: UpdateSyncScheduleDto) => o.frequency === 'weekly')
  @IsInt()
  @Min(0)
  @Max(6)
  weekly_day_of_week?: number;

  @ValidateIf((o: UpdateSyncScheduleDto) => o.frequency === 'weekly')
  @IsString()
  @Matches(TIME_PATTERN)
  weekly_time?: string;

  @ValidateIf((o: UpdateSyncScheduleDto) => o.frequency === 'monthly')
  @IsInt()
  @Min(1)
  @Max(31)
  monthly_day_of_month?: number;

  @ValidateIf((o: UpdateSyncScheduleDto) => o.frequency === 'monthly')
  @IsString()
  @Matches(TIME_PATTERN)
  monthly_time?: string;

  @IsOptional()
  @IsBoolean()
  run_next_market_day_if_closed?: boolean;
}

export function normalizeScheduleForFrequency(
  dto: UpdateSyncScheduleDto,
  existing?: DataSyncJobSchedule | null,
): Omit<DataSyncJobSchedule, 'job_key' | 'updated_at' | 'updated_by_user_id'> {
  const frequency = dto.frequency ?? existing?.frequency ?? 'weekly';
  const base = {
    enabled: dto.enabled ?? existing?.enabled ?? true,
    frequency,
    timezone: 'America/New_York',
    market_days_only: dto.market_days_only ?? existing?.market_days_only ?? false,
    run_next_market_day_if_closed:
      dto.run_next_market_day_if_closed ??
      existing?.run_next_market_day_if_closed ??
      false,
    hourly_interval_hours: null as number | null,
    hourly_start_time: null as string | null,
    daily_time: null as string | null,
    weekly_day_of_week: null as number | null,
    weekly_time: null as string | null,
    monthly_day_of_month: null as number | null,
    monthly_time: null as string | null,
  };

  switch (frequency) {
    case 'hourly':
      base.hourly_interval_hours =
        dto.hourly_interval_hours ?? existing?.hourly_interval_hours ?? 1;
      base.hourly_start_time =
        dto.hourly_start_time ?? existing?.hourly_start_time ?? '00:00';
      break;
    case 'daily':
      base.daily_time = dto.daily_time ?? existing?.daily_time ?? '09:00';
      break;
    case 'weekly':
      base.weekly_day_of_week =
        dto.weekly_day_of_week ?? existing?.weekly_day_of_week ?? 1;
      base.weekly_time = dto.weekly_time ?? existing?.weekly_time ?? '10:00';
      break;
    case 'monthly':
      base.monthly_day_of_month =
        dto.monthly_day_of_month ?? existing?.monthly_day_of_month ?? 1;
      base.monthly_time = dto.monthly_time ?? existing?.monthly_time ?? '09:00';
      break;
  }

  return base;
}

export function validateScheduleDto(
  dto: UpdateSyncScheduleDto,
  existing?: DataSyncJobSchedule | null,
): string | null {
  const frequency = dto.frequency ?? existing?.frequency;
  if (!frequency) return 'frequency is required';
  if (frequency === 'hourly') {
    if (dto.hourly_interval_hours == null && existing?.hourly_interval_hours == null) {
      return 'hourly_interval_hours is required for hourly frequency';
    }
  }
  return null;
}
