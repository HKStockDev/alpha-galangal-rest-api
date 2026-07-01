import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DataSyncJobSchedule } from './data-sync.types';
import { shouldRunNow } from './schedule-evaluator';

function baseSchedule(
  overrides: Partial<DataSyncJobSchedule> = {},
): DataSyncJobSchedule {
  return {
    job_key: 'politicalScore',
    enabled: true,
    frequency: 'weekly',
    timezone: 'America/New_York',
    hourly_interval_hours: null,
    hourly_start_time: null,
    market_days_only: false,
    daily_time: null,
    weekly_day_of_week: 1,
    weekly_time: '10:00',
    monthly_day_of_month: null,
    monthly_time: null,
    run_next_market_day_if_closed: false,
    updated_at: new Date().toISOString(),
    updated_by_user_id: null,
    ...overrides,
  };
}

/** Build a Date whose NY wall clock matches the given local parts (approximate). */
function nyLocalDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const winter = new Date(`${iso}-05:00`);
  const summer = new Date(`${iso}-04:00`);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).format(d);
  return fmt(winter) === `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    ? winter
    : summer;
}

describe('ScheduleEvaluator', () => {
  it('weekly: runs after scheduled time on matching weekday', () => {
    const schedule = baseSchedule({ frequency: 'weekly', weekly_day_of_week: 1, weekly_time: '10:00' });
    const now = nyLocalDate(2026, 3, 2, 10, 30);
    assert.equal(shouldRunNow(schedule, now, null), true);
  });

  it('weekly: does not run before scheduled time', () => {
    const schedule = baseSchedule({ frequency: 'weekly', weekly_day_of_week: 1, weekly_time: '10:00' });
    const now = nyLocalDate(2026, 3, 2, 9, 45);
    assert.equal(shouldRunNow(schedule, now, null), false);
  });

  it('weekly: idempotent within same slot', () => {
    const schedule = baseSchedule({ frequency: 'weekly', weekly_day_of_week: 1, weekly_time: '10:00' });
    const now = nyLocalDate(2026, 3, 2, 10, 30);
    const lastRun = { at: nyLocalDate(2026, 3, 2, 10, 15).toISOString(), ok: true };
    assert.equal(shouldRunNow(schedule, now, lastRun), false);
  });

  it('daily: skips non-trading days when market_days_only', () => {
    const schedule = baseSchedule({
      frequency: 'daily',
      daily_time: '09:00',
      market_days_only: true,
      weekly_day_of_week: null,
      weekly_time: null,
    });
    const saturday = nyLocalDate(2026, 3, 7, 10, 0);
    assert.equal(shouldRunNow(schedule, saturday, null), false);
  });

  it('hourly: every 6 hours from start time', () => {
    const schedule = baseSchedule({
      frequency: 'hourly',
      hourly_interval_hours: 6,
      hourly_start_time: '06:00',
      weekly_day_of_week: null,
      weekly_time: null,
    });
    const atSix = nyLocalDate(2026, 3, 2, 6, 5);
    assert.equal(shouldRunNow(schedule, atSix, null), true);
    const atFive = nyLocalDate(2026, 3, 2, 5, 30);
    assert.equal(shouldRunNow(schedule, atFive, null), false);
  });

  it('disabled schedule never runs', () => {
    const schedule = baseSchedule({ enabled: false });
    const now = nyLocalDate(2026, 3, 2, 12, 0);
    assert.equal(shouldRunNow(schedule, now, null), false);
  });

  it('monthly: runs on configured day after time', () => {
    const schedule = baseSchedule({
      frequency: 'monthly',
      monthly_day_of_month: 1,
      monthly_time: '09:00',
      weekly_day_of_week: null,
      weekly_time: null,
    });
    const now = nyLocalDate(2026, 3, 1, 9, 30);
    assert.equal(shouldRunNow(schedule, now, null), true);
  });
});
