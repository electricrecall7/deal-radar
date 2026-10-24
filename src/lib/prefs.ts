import type { Benefit, Category, Deal } from './schema';

/** Where the weekly GitHub Action publishes data/deals.json. Editable in Alerts > Data. */
export const DEFAULT_DEALS_URL =
  'https://raw.githubusercontent.com/electricrecall7/deal-radar/main/data/deals.json';

export type Override = 'on' | 'off';

export interface Prefs {
  notificationsEnabled: boolean;
  /** HH:MM when "happening today" reminders fire. */
  digestTime: string;
  /** Extra heads-up this many minutes before a timed drop (Taco Bell 1 PM). 0 = off. */
  leadMinutes: number;
  /** -1 = no ending reminders, 0 = last day only, n = n days before and on the last day. */
  expiryDaysBefore: number;
  /** -1 = no credit reminders, 0 = last day only, n = n days before and on the last day. */
  benefitDaysBefore: number;
  /** Sunday 6 PM preview of the coming week. */
  weeklyPreview: boolean;
  /** Monday 10 AM nudge to open the app after the weekly search runs. */
  refreshNudge: boolean;
  /**
   * Remind on the day of every weekly special (kids-eat-free nights, happy hours...). Off by default:
   * there are dozens, so only the ones the user switches to Always ping them.
   */
  weeklyReminders: boolean;
  includeUnconfirmed: boolean;
  categories: Record<Category, boolean>;
  /** restaurantKey() values whose deals are hidden everywhere and never notify. */
  mutedRestaurants: string[];
  /** Per-deal choice that beats the restaurant and category switches. */
  dealOverrides: Record<string, Override>;
  mutedBenefits: string[];
  hiddenDeals: string[];
  dataUrl: string;
}

export const DEFAULT_PREFS: Prefs = {
  notificationsEnabled: true,
  digestTime: '09:00',
  leadMinutes: 15,
  expiryDaysBefore: 1,
  benefitDaysBefore: 3,
  weeklyPreview: true,
  refreshNudge: true,
  weeklyReminders: false,
  includeUnconfirmed: true,
  categories: { freebie: true, app: true, deal: true, card: true, delivery: true },
  mutedRestaurants: [],
  dealOverrides: {},
  mutedBenefits: [],
  hiddenDeals: [],
  dataUrl: DEFAULT_DEALS_URL,
};

/** Fill in fields added after the user's prefs were saved, and drop retired ones. */
export function withDefaults(stored: Partial<Prefs> | null | undefined): Prefs {
  // cardVariants (one card picked per issuer) was replaced by the fixed list in wallet.ts.
  const { cardVariants: _retired, ...rest } = (stored ?? {}) as Partial<Prefs> & { cardVariants?: unknown };
  return {
    ...DEFAULT_PREFS,
    ...rest,
    categories: { ...DEFAULT_PREFS.categories, ...stored?.categories },
    dealOverrides: { ...stored?.dealOverrides },
    mutedRestaurants: [...(stored?.mutedRestaurants ?? [])],
    mutedBenefits: [...(stored?.mutedBenefits ?? [])],
    hiddenDeals: [...(stored?.hiddenDeals ?? [])],
  };
}

export function restaurantKey(name: string): string {
  return name.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
}

export function isRestaurantMuted(prefs: Prefs, restaurant: string): boolean {
  return prefs.mutedRestaurants.includes(restaurantKey(restaurant));
}

/** Hidden by hand, or from a muted restaurant: left out of every list and never notifies. */
export function isDealHidden(deal: Deal, prefs: Prefs): boolean {
  return prefs.hiddenDeals.includes(deal.id) || isRestaurantMuted(prefs, deal.restaurant);
}

/**
 * Should this deal send notifications? Most specific setting wins:
 * hidden or muted restaurant > per-deal switch > category / unconfirmed filters.
 */
export function wantsDeal(deal: Deal, prefs: Prefs): boolean {
  if (isDealHidden(deal, prefs)) return false;
  const override = prefs.dealOverrides[deal.id];
  if (override) return override === 'on';
  if (!prefs.categories[deal.category]) return false;
  if (!prefs.includeUnconfirmed && deal.status === 'unconfirmed') return false;
  return true;
}

/**
 * Whether the planner will actually send anything for this deal: wantsDeal plus the kind rules —
 * ongoing perks never notify, and weekly specials only when weeklyReminders is on or the deal is
 * switched to Always.
 */
export function dealNotifies(deal: Deal, prefs: Prefs): boolean {
  if (!prefs.notificationsEnabled || !wantsDeal(deal, prefs)) return false;
  if (deal.days && deal.days.length > 0) return prefs.weeklyReminders || prefs.dealOverrides[deal.id] === 'on';
  return !!deal.end;
}

export function wantsBenefit(b: Benefit, prefs: Prefs): boolean {
  return !prefs.mutedBenefits.includes(b.id) && b.period !== 'none';
}
