/** US equity market holidays (NYSE closed), YYYY-MM-DD in America/New_York calendar dates. */
const US_MARKET_HOLIDAYS = new Set<string>([
  // 2025
  '2025-01-01',
  '2025-01-20',
  '2025-02-17',
  '2025-04-18',
  '2025-05-26',
  '2025-06-19',
  '2025-07-04',
  '2025-09-01',
  '2025-11-27',
  '2025-12-25',
  // 2026
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  // 2027
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
]);

const NY_TZ = 'America/New_York';

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function nyDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function nyWeekday(date: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    weekday: 'short',
  }).format(date);
  return WEEKDAY_MAP[wd] ?? 0;
}

export function nyYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value ?? 1970),
    month: Number(parts.find((p) => p.type === 'month')?.value ?? 1),
  };
}

export function nyDayOfMonth(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TZ,
    day: '2-digit',
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'day')?.value ?? 1);
}

export function nyMinutesSinceMidnight(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isTradingDay(date: Date): boolean {
  const dow = nyWeekday(date);
  if (dow === 0 || dow === 6) return false;
  return !US_MARKET_HOLIDAYS.has(nyDateKey(date));
}

/** Next trading day on or after the given instant (NY calendar). */
export function nextTradingDay(date: Date): Date {
  let cursor = date;
  for (let i = 0; i < 14; i++) {
    if (isTradingDay(cursor)) return cursor;
    cursor = addNyDays(cursor, 1);
  }
  return cursor;
}

export function addNyDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function clampMonthlyDay(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

/** NY calendar date for the effective monthly run day in the given month. */
export function monthlyEffectiveDateKey(
  year: number,
  month: number,
  dayOfMonth: number,
  runNextMarketDayIfClosed: boolean,
): string {
  const dom = clampMonthlyDay(year, month, dayOfMonth);
  const key = `${year}-${String(month).padStart(2, '0')}-${String(dom).padStart(2, '0')}`;
  if (!runNextMarketDayIfClosed) return key;
  let cursor = new Date(`${key}T17:00:00.000Z`);
  if (isTradingDay(cursor)) return nyDateKey(cursor);
  return nyDateKey(nextTradingDay(addNyDays(cursor, 1)));
}
