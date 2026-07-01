import type { DataSyncJobSchedule, DataSyncLastRun } from './data-sync.types';
import {
  isTradingDay,
  monthlyEffectiveDateKey,
  nyDateKey,
  nyMinutesSinceMidnight,
  nyWeekday,
  nyYearMonth,
  parseTimeToMinutes,
} from './us-market-calendar';

export interface ScheduleSlot {
  slotKey: string;
  due: boolean;
}

export function computeScheduleSlot(
  schedule: DataSyncJobSchedule,
  now: Date,
): ScheduleSlot {
  if (!schedule.enabled) {
    return { slotKey: '', due: false };
  }

  if (schedule.market_days_only && !isTradingDay(now)) {
    return { slotKey: '', due: false };
  }

  switch (schedule.frequency) {
    case 'hourly':
      return computeHourlySlot(schedule, now);
    case 'daily':
      return computeDailySlot(schedule, now);
    case 'weekly':
      return computeWeeklySlot(schedule, now);
    case 'monthly':
      return computeMonthlySlot(schedule, now);
    default:
      return { slotKey: '', due: false };
  }
}

export function shouldRunNow(
  schedule: DataSyncJobSchedule,
  now: Date,
  lastRun: DataSyncLastRun | null | undefined,
): boolean {
  const slot = computeScheduleSlot(schedule, now);
  if (!slot.due || !slot.slotKey) return false;
  if (lastRun?.running) return false;
  if (!lastRun?.at) return true;
  const lastSlot = computeScheduleSlot(schedule, new Date(lastRun.at));
  return lastSlot.slotKey !== slot.slotKey;
}

function computeHourlySlot(schedule: DataSyncJobSchedule, now: Date): ScheduleSlot {
  const interval = schedule.hourly_interval_hours ?? 1;
  const start = schedule.hourly_start_time
    ? parseTimeToMinutes(schedule.hourly_start_time)
    : 0;
  const nowMinutes = nyMinutesSinceMidnight(now);
  if (nowMinutes < start) {
    return { slotKey: '', due: false };
  }
  const elapsed = nowMinutes - start;
  const slotIndex = Math.floor(elapsed / (interval * 60));
  const slotStartMinutes = start + slotIndex * interval * 60;
  const h = Math.floor(slotStartMinutes / 60);
  const m = slotStartMinutes % 60;
  const slotKey = `hourly:${nyDateKey(now)}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { slotKey, due: true };
}

function computeDailySlot(schedule: DataSyncJobSchedule, now: Date): ScheduleSlot {
  const dailyTime = schedule.daily_time
    ? parseTimeToMinutes(schedule.daily_time)
    : 0;
  const nowMinutes = nyMinutesSinceMidnight(now);
  if (nowMinutes < dailyTime) {
    return { slotKey: '', due: false };
  }
  return { slotKey: `daily:${nyDateKey(now)}`, due: true };
}

function computeWeeklySlot(schedule: DataSyncJobSchedule, now: Date): ScheduleSlot {
  const targetDow = schedule.weekly_day_of_week ?? 1;
  if (nyWeekday(now) !== targetDow) {
    return { slotKey: '', due: false };
  }
  const weeklyTime = schedule.weekly_time
    ? parseTimeToMinutes(schedule.weekly_time)
    : 0;
  if (nyMinutesSinceMidnight(now) < weeklyTime) {
    return { slotKey: '', due: false };
  }
  return { slotKey: `weekly:${nyDateKey(now)}`, due: true };
}

function computeMonthlySlot(schedule: DataSyncJobSchedule, now: Date): ScheduleSlot {
  const { year, month } = nyYearMonth(now);
  const dom = schedule.monthly_day_of_month ?? 1;
  const effectiveKey = monthlyEffectiveDateKey(
    year,
    month,
    dom,
    schedule.run_next_market_day_if_closed,
  );
  if (nyDateKey(now) !== effectiveKey) {
    return { slotKey: '', due: false };
  }
  const monthlyTime = schedule.monthly_time
    ? parseTimeToMinutes(schedule.monthly_time)
    : 0;
  if (nyMinutesSinceMidnight(now) < monthlyTime) {
    return { slotKey: '', due: false };
  }
  return { slotKey: `monthly:${year}-${String(month).padStart(2, '0')}`, due: true };
}

export function formatTimeHm(time: string | null): string {
  if (!time) return '00:00';
  return time.slice(0, 5);
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatScheduleSummary(schedule: DataSyncJobSchedule): string {
  const tz = schedule.timezone || 'America/New_York';
  const parts: string[] = [];
  if (!schedule.enabled) {
    parts.push('Disabled');
  }
  switch (schedule.frequency) {
    case 'hourly': {
      const interval = schedule.hourly_interval_hours ?? 1;
      const start = formatTimeHm(schedule.hourly_start_time);
      parts.push(`Every ${interval}h from ${start}`);
      break;
    }
    case 'daily':
      parts.push(`Daily at ${formatTimeHm(schedule.daily_time)}`);
      break;
    case 'weekly': {
      const dow = schedule.weekly_day_of_week ?? 1;
      parts.push(
        `Weekly ${WEEKDAY_NAMES[dow]} at ${formatTimeHm(schedule.weekly_time)}`,
      );
      break;
    }
    case 'monthly': {
      const dom = schedule.monthly_day_of_month ?? 1;
      parts.push(
        `Monthly day ${dom} at ${formatTimeHm(schedule.monthly_time)}`,
      );
      if (schedule.run_next_market_day_if_closed) {
        parts.push('next market day if closed');
      }
      break;
    }
  }
  if (schedule.market_days_only && schedule.frequency !== 'weekly') {
    parts.push('market days only');
  }
  parts.push(tz);
  return parts.join(', ');
}
