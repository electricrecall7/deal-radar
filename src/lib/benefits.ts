import { addDays, daysInMonth, diffDays, pad2, ymdParts, type YMD } from './dates';
import type { Benefit, Period } from './schema';

export interface PeriodBounds {
  /** Stable label for the period, e.g. 2026-10, 2026-Q4, 2026-H2, 2026. */
  key: string;
  start: YMD;
  end: YMD;
}

/** Card credits reset on calendar periods (Amex resets on the 1st). */
export function periodBounds(period: Period, day: YMD): PeriodBounds | null {
  const { y, m } = ymdParts(day);
  const range = (startMonth: number, endMonth: number, key: string): PeriodBounds => ({
    key,
    start: `${y}-${pad2(startMonth)}-01`,
    end: `${y}-${pad2(endMonth)}-${pad2(daysInMonth(y, endMonth))}`,
  });
  switch (period) {
    case 'monthly':
      return range(m, m, `${y}-${pad2(m)}`);
    case 'quarterly': {
      const q = Math.floor((m - 1) / 3) + 1;
      return range((q - 1) * 3 + 1, q * 3, `${y}-Q${q}`);
    }
    case 'semiannual':
      return m <= 6 ? range(1, 6, `${y}-H1`) : range(7, 12, `${y}-H2`);
    case 'annual':
      return range(1, 12, `${y}`);
    default:
      return null;
  }
}

/** Periods (current first) whose last day falls within `horizonDays` of today. */
export function upcomingPeriods(period: Period, today: YMD, horizonDays: number): PeriodBounds[] {
  const out: PeriodBounds[] = [];
  let p = periodBounds(period, today);
  while (p && diffDays(today, p.end) <= horizonDays) {
    out.push(p);
    p = periodBounds(period, addDays(p.end, 1));
  }
  return out;
}

/** Map of benefit id -> period key the user marked as used. */
export type UsedCredits = Record<string, string>;

export function isBenefitUsed(b: Benefit, used: UsedCredits, today: YMD): boolean {
  const p = periodBounds(b.period, today);
  return !!p && used[b.id] === p.key;
}

/** Days until the current period resets (0 = last day), or undefined for perks that don't reset. */
export function benefitDaysLeft(b: Benefit, today: YMD): number | undefined {
  const p = periodBounds(b.period, today);
  return p ? diffDays(today, p.end) : undefined;
}
