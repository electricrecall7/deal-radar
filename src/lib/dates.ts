// Calendar dates are 'YYYY-MM-DD' strings in the phone's local time zone
// (San Antonio is America/Chicago). Plain strings sort and compare correctly.
export type YMD = string;

const DAY_MS = 86_400_000;

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function toYMD(d: Date): YMD {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayYMD(now: Date = new Date()): YMD {
  return toYMD(now);
}

export function ymdParts(s: YMD): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** Local midnight of the given day. */
export function parseYMD(s: YMD): Date {
  const { y, m, d } = ymdParts(s);
  return new Date(y, m - 1, d);
}

function utcDayNumber(s: YMD): number {
  const { y, m, d } = ymdParts(s);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromUtcDayNumber(n: number): YMD {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Calendar arithmetic that ignores daylight-saving shifts. */
export function addDays(s: YMD, n: number): YMD {
  return fromUtcDayNumber(utcDayNumber(s) + n);
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a: YMD, b: YMD): number {
  return utcDayNumber(b) - utcDayNumber(a);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(s: YMD): number {
  return new Date(utcDayNumber(s) * DAY_MS).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function firstOfMonth(year: number, month: number): YMD {
  return `${year}-${pad2(month)}-01`;
}

export function lastOfMonth(year: number, month: number): YMD {
  return `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
}

/** Shift a (year, month) pair by n months; month is 1-12. */
export function shiftMonth(year: number, month: number, n: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The local Date for a day at HH:MM. */
export function atTime(s: YMD, hhmm = '00:00'): Date {
  const date = parseYMD(s);
  const [h, mi] = hhmm.split(':').map(Number);
  date.setHours(h, mi, 0, 0);
  return date;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function hhmmFromMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

/** The next date on or after `from` that falls on `dow`. */
export function nextWeekday(from: YMD, dow: number): YMD {
  return addDays(from, (dow - weekday(from) + 7) % 7);
}
