import { diffDays, pad2, weekday, ymdParts, type YMD } from './dates';
import { dealKind } from './occurrences';
import type { Deal, Period } from './schema';

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** '13:00' -> '1 PM', '16:30' -> '4:30 PM' */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${pad2(m)} ${suffix}` : `${h12} ${suffix}`;
}

export function formatTimeRange(start?: string, end?: string): string {
  if (start && end) return `${formatTime(start)}–${formatTime(end)}`;
  if (start) return `from ${formatTime(start)}`;
  if (end) return `until ${formatTime(end)}`;
  return '';
}

/** 'Oct 24' */
export function formatShortDate(day: YMD): string {
  const { m, d } = ymdParts(day);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

/** 'Sat, Oct 24' */
export function formatDay(day: YMD): string {
  return `${WEEKDAYS_SHORT[weekday(day)]}, ${formatShortDate(day)}`;
}

/** 'Saturday, October 24' */
export function formatLongDay(day: YMD): string {
  const { m, d } = ymdParts(day);
  return `${WEEKDAYS_LONG[weekday(day)]}, ${MONTHS_LONG[m - 1]} ${d}`;
}

/** 'Today', 'Tomorrow', 'Wed' (within a week), else 'Oct 31'. */
export function relativeDay(day: YMD, today: YMD): string {
  const n = diffDays(today, day);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WEEKDAYS_SHORT[weekday(day)];
  return formatShortDate(day);
}

/** [2] -> 'Tue', [1,5] -> 'Mon & Fri', [1,2,3,4,5] -> 'weekday' */
export function formatDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'day';
  if (sorted.join() === '1,2,3,4,5') return 'weekday';
  if (sorted.join() === '0,6') return 'weekend day';
  const names = sorted.map((d) => WEEKDAYS_SHORT[d]);
  if (names.length <= 2) return names.join(' & ');
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** One-line "when" for lists, e.g. 'Every Tue · from 1 PM', 'Through Oct 31', 'Today only'. */
export function describeWhen(deal: Deal, today: YMD): string {
  const time = deal.startTime || deal.endTime ? ` · ${formatTimeRange(deal.startTime, deal.endTime)}` : '';
  const kind = dealKind(deal);
  if (kind === 'weekly') {
    const until = deal.end ? ` · thru ${formatShortDate(deal.end)}` : '';
    const from = deal.start > today ? ` · starts ${formatShortDate(deal.start)}` : '';
    return `Every ${formatDays(deal.days ?? [])}${time}${from}${until}`;
  }
  if (kind === 'ongoing') {
    return deal.start > today ? `Starts ${formatShortDate(deal.start)}` : 'Ongoing';
  }
  const end = deal.end!;
  if (deal.start === end) return `${relativeDay(end, today)} only${time}`;
  if (deal.start > today) return `${formatShortDate(deal.start)} – ${formatShortDate(end)}${time}`;
  if (end === today) return `Ends today${time}`;
  if (diffDays(today, end) === 1) return `Ends tomorrow${time}`;
  return `Through ${formatShortDate(end)}${time}`;
}

export function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export function periodLabel(period: Period): string {
  switch (period) {
    case 'monthly':
      return 'every month';
    case 'quarterly':
      return 'every quarter';
    case 'semiannual':
      return 'every half-year';
    case 'annual':
      return 'every year';
    default:
      return '';
  }
}

export function daysLeftLabel(n: number): string {
  if (n <= 0) return 'resets tonight';
  if (n === 1) return 'resets tomorrow night';
  return `resets in ${n} days`;
}
