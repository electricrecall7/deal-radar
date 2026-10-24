// The weekly promo-code sweep: which restaurants to search, and one discovery angle per batch of them.
import { restaurantKey } from '../../src/lib/prefs';
import type { Deal } from '../../src/lib/schema';
import { CODE_BATCH, CODE_FETCHES, CODE_SEARCHES } from './config';
import type { Angle } from './prompts';

export const CODES_ANGLE = 'promo-codes';

/** Restaurants with at least this many live deals get a code search even if they aren't on the list. */
const AUTO_INCLUDE_MIN_DEALS = 2;

// "Chick-fil-A" and "Chick fil A", "McDonalds" and "McDonald's" are the same place.
const looseKey = (name: string) =>
  restaurantKey(name.replace(/\s*\(.*\)\s*$/, ''))
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');

/**
 * The hand-kept watchlist first (in its order), then restaurants that keep showing up in the deal
 * list. Card offers are skipped: their "restaurant" is a merchant inside a card program.
 */
export function buildCodeWatchlist(listed: string[], deals: Deal[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string) => {
    const key = looseKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(name.trim());
  };
  listed.forEach(add);

  const counts = new Map<string, { name: string; n: number }>();
  for (const d of deals) {
    if (d.category === 'card' || d.custom) continue;
    const key = looseKey(d.restaurant);
    const entry = counts.get(key) ?? { name: d.restaurant.replace(/\s*\(.*\)\s*$/, ''), n: 0 };
    entry.n++;
    counts.set(key, entry);
  }
  [...counts.values()]
    .filter((c) => c.n >= AUTO_INCLUDE_MIN_DEALS)
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .forEach((c) => add(c.name));
  return out;
}

export function promoCodeAngles(restaurants: string[], batchSize = CODE_BATCH): Angle[] {
  const angles: Angle[] = [];
  for (let i = 0; i < restaurants.length; i += batchSize) {
    const batch = restaurants.slice(i, i + batchSize);
    angles.push({
      name: `${CODES_ANGLE}-${angles.length + 1}`,
      windowDays: 28,
      searches: CODE_SEARCHES,
      fetches: CODE_FETCHES,
      task: `Find promo codes that work right now at these restaurants: codes typed at checkout in the brand's app or website, codes for the brand on DoorDash, Uber Eats or Grubhub, rewards codes, new-customer codes, holiday codes and delivery-fee codes.
Many fast-food chains (Dunkin', Wendy's, Taco Bell, McDonald's, Burger King and others) put out a new set of app offers and codes every month: find this month's, including app-only offers that need no code (category app, no code).
Restaurants: ${batch.join('; ')}.
Evidence is strict for codes, because coupon sites list stale and fake ones:
- Coupon aggregators on their own (RetailMeNot, Coupons.com, CouponFollow, Knoji, Dealspotr, CouponBirds, Wethrift, GrabOn, DealDrop and the like) are not enough. Keep a code only if the brand announced it (site, app, press release, or an official post or email quoted by a reputable outlet), or a reputable deal site, a Slickdeals post or a Reddit thread from the last ~45 days reports it working.
- Check that it is for the U.S. (not a UK or India site with the same brand name) and not an earlier year's code.
- Put the exact code in code, preserving case, and the value in title (for example "$5 off $25+ online"). Put the minimum spend, new vs. existing customers, one-time use and channels in details. Tag promo-code.
- Set end to the published expiration. If none is published, leave end empty and say "No published expiration" in notes.
- Use category app for app or rewards-only codes, delivery for delivery-platform codes, and deal otherwise.
Use about one search per restaurant (combine terms, for example "<brand> promo code <month> <year>"), then open the pages that settle it.`,
    });
  }
  return angles;
}
