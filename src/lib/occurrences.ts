import { addDays, diffDays, weekday, type YMD } from './dates';
import type { Deal } from './schema';

/**
 * weekly  - runs on certain weekdays (Taco Tuesday)
 * dated   - runs every day between start and end (a promo window or a one-day event)
 * ongoing - no end date (sign-up rewards, birthday perks)
 */
export type DealKind = 'weekly' | 'dated' | 'ongoing';

export function dealKind(d: Deal): DealKind {
  if (d.days && d.days.length > 0) return 'weekly';
  if (d.end) return 'dated';
  return 'ongoing';
}

export function occursOn(d: Deal, day: YMD): boolean {
  if (day < d.start) return false;
  if (d.end && day > d.end) return false;
  if (d.days && d.days.length > 0) return d.days.includes(weekday(day));
  return true;
}

export function isOver(d: Deal, today: YMD): boolean {
  return !!d.end && d.end < today;
}

/** Days between start and end; 0 for a one-day deal, undefined if ongoing. */
export function spanDays(d: Deal): number | undefined {
  return d.end ? diffDays(d.start, d.end) : undefined;
}

export function isOneDay(d: Deal): boolean {
  return dealKind(d) === 'dated' && spanDays(d) === 0;
}

/** Long promos only mark their first and last day so the month view stays readable. */
export const LONG_PROMO_DAYS = 6;

/** Whether a deal gets a dot on this calendar day. */
export function isCalendarDay(d: Deal, day: YMD): boolean {
  if (!occursOn(d, day)) return false;
  const kind = dealKind(d);
  if (kind === 'weekly') return true;
  if (kind === 'ongoing') return false;
  return (spanDays(d) ?? 0) <= LONG_PROMO_DAYS || day === d.start || day === d.end;
}

export function nextOccurrence(d: Deal, from: YMD, horizonDays = 120): YMD | undefined {
  let day = from < d.start ? d.start : from;
  for (let i = 0; i <= horizonDays; i++) {
    if (d.end && day > d.end) return undefined;
    if (occursOn(d, day)) return day;
    day = addDays(day, 1);
  }
  return undefined;
}

/** Timed deals first by start time, then alphabetical. */
export function compareDeals(a: Deal, b: Deal): number {
  const ta = a.startTime ?? '99:99';
  const tb = b.startTime ?? '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.restaurant.localeCompare(b.restaurant) || a.title.localeCompare(b.title);
}

export function dealsOn(deals: Deal[], day: YMD): Deal[] {
  return deals.filter((d) => occursOn(d, day)).sort(compareDeals);
}
