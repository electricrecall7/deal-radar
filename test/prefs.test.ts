import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dealMentions,
  DEFAULT_PREFS,
  isDealHidden,
  isRestaurantMuted,
  mutedWordFor,
  normalizeText,
  restaurantKey,
  wantsBenefit,
  wantsDeal,
  withDefaults,
  type Prefs,
} from '../src/lib/prefs';
import { CATEGORIES, type Benefit, type Category, type Deal } from '../src/lib/schema';

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: 'tb-tue',
    restaurant: 'Taco Bell',
    title: '$1 meal',
    category: 'app',
    start: '2026-10-01',
    days: [2],
    status: 'confirmed',
    ...over,
  };
}

function prefs(over: Partial<Prefs> = {}): Prefs {
  return { ...DEFAULT_PREFS, ...over };
}

const allOn = DEFAULT_PREFS.categories;
const without = (c: Category) => ({ ...allOn, [c]: false });

describe('DEFAULT_PREFS', () => {
  it('turns on every category', () => {
    for (const c of CATEGORIES) assert.equal(DEFAULT_PREFS.categories[c], true, c);
  });

  it('wants a plain deal', () => {
    assert.equal(wantsDeal(deal(), DEFAULT_PREFS), true);
  });
});

describe('wantsDeal precedence', () => {
  it('hidden beats a per-deal override of on', () => {
    const p = prefs({ hiddenDeals: ['tb-tue'], dealOverrides: { 'tb-tue': 'on' } });
    assert.equal(wantsDeal(deal(), p), false);
  });

  it('a muted restaurant beats a per-deal override of on', () => {
    const p = prefs({ mutedRestaurants: ['taco bell'], dealOverrides: { 'tb-tue': 'on' } });
    assert.equal(wantsDeal(deal(), p), false);
    assert.equal(wantsDeal(deal({ restaurant: 'Whataburger' }), p), true);
  });

  it('override on beats a disabled category', () => {
    const p = prefs({ categories: without('app'), dealOverrides: { 'tb-tue': 'on' } });
    assert.equal(wantsDeal(deal(), p), true);
    assert.equal(wantsDeal(deal({ id: 'other' }), p), false);
  });

  it('override on beats the unconfirmed filter', () => {
    const p = prefs({ includeUnconfirmed: false, dealOverrides: { 'tb-tue': 'on' } });
    assert.equal(wantsDeal(deal({ status: 'unconfirmed' }), p), true);
  });

  it('override off beats everything else being on', () => {
    const p = prefs({ dealOverrides: { 'tb-tue': 'off' } });
    assert.equal(wantsDeal(deal(), p), false);
    assert.equal(wantsDeal(deal({ id: 'other' }), p), true);
  });

  it('a disabled category silences its deals only', () => {
    const p = prefs({ categories: without('app') });
    assert.equal(wantsDeal(deal(), p), false);
    assert.equal(wantsDeal(deal({ category: 'freebie' }), p), true);
  });

  it('a muted restaurant silences its deals regardless of spelling', () => {
    const p = prefs({ mutedRestaurants: [restaurantKey('Wendy’s')] });
    assert.equal(wantsDeal(deal({ restaurant: "Wendy's" }), p), false);
    assert.equal(wantsDeal(deal({ restaurant: '  WENDY’S ' }), p), false);
    assert.equal(wantsDeal(deal({ restaurant: 'Taco Bell' }), p), true);
  });

  it('includeUnconfirmed false filters unconfirmed deals only', () => {
    const p = prefs({ includeUnconfirmed: false });
    assert.equal(wantsDeal(deal({ status: 'unconfirmed' }), p), false);
    assert.equal(wantsDeal(deal({ status: 'confirmed' }), p), true);
    assert.equal(wantsDeal(deal({ status: 'unconfirmed' }), prefs({ includeUnconfirmed: true })), true);
  });

  it('a hidden deal stays silent even when everything else is on', () => {
    assert.equal(wantsDeal(deal(), prefs({ hiddenDeals: ['tb-tue'] })), false);
  });
});

describe('isDealHidden', () => {
  it('covers deals hidden by hand and every deal from a muted restaurant', () => {
    const p = prefs({ hiddenDeals: ['x'], mutedRestaurants: [restaurantKey('Wendy’s')] });
    assert.equal(isDealHidden(deal({ id: 'x' }), p), true);
    assert.equal(isDealHidden(deal({ restaurant: "Wendy's" }), p), true);
    assert.equal(isDealHidden(deal(), p), false);
  });
});

describe('muted words', () => {
  it('match the title or tags at the start of a word, ignoring case and curly apostrophes', () => {
    assert.equal(dealMentions(deal({ title: 'Kids’ meals $1.99 on Tuesdays' }), 'kids'), true);
    assert.equal(dealMentions(deal({ title: 'Kids eat free' }), 'kid'), true);
    assert.equal(dealMentions(deal({ title: 'Free skids' }), 'kid'), false);
    assert.equal(dealMentions(deal({ title: 'BOGO pizza', tags: ['kids-eat-free'] }), 'kids eat free'), true);
  });

  it('leave the details and restaurant name out', () => {
    const d = deal({ restaurant: 'Kids Pizza Co', title: 'BOGO pizza', details: 'Not valid on kids’ meals.' });
    assert.equal(dealMentions(d, 'kids'), false);
  });

  it('hide matching deals everywhere, even ones set to Always', () => {
    const p = prefs({ mutedWords: [normalizeText(' Kids ')], dealOverrides: { 'tb-tue': 'on' } });
    const kids = deal({ title: 'Kids eat free Tuesdays' });
    assert.equal(mutedWordFor(kids, p), 'kids');
    assert.equal(isDealHidden(kids, p), true);
    assert.equal(wantsDeal(kids, p), false);
    assert.equal(isDealHidden(deal(), p), false);
  });

  it('ignore a blank word instead of hiding everything', () => {
    assert.equal(isDealHidden(deal(), prefs({ mutedWords: [''] })), false);
  });

  it('survive a round trip through withDefaults', () => {
    assert.deepEqual(withDefaults({ mutedWords: ['kids'] }).mutedWords, ['kids']);
    assert.deepEqual(withDefaults(null).mutedWords, []);
  });
});

describe('restaurantKey / isRestaurantMuted', () => {
  it('normalizes case, outer and inner whitespace, and curly apostrophes', () => {
    assert.equal(restaurantKey('Taco Bell'), 'taco bell');
    assert.equal(restaurantKey('  Taco   Bell  '), 'taco bell');
    assert.equal(restaurantKey('Taco\tBell'), 'taco bell');
    assert.equal(restaurantKey('Wendy’s'), "wendy's");
    assert.equal(restaurantKey('Wendy‘s'), "wendy's");
    assert.equal(restaurantKey("Panchito's"), "panchito's");
  });

  it('treats differently written names as the same restaurant', () => {
    assert.equal(restaurantKey('CHICK-FIL-A'), restaurantKey('Chick-fil-A'));
    assert.equal(restaurantKey('Raising Cane’s '), restaurantKey("raising  cane's"));
  });

  it('checks the muted list by key', () => {
    const p = prefs({ mutedRestaurants: ["raising cane's"] });
    assert.equal(isRestaurantMuted(p, 'Raising Cane’s'), true);
    assert.equal(isRestaurantMuted(p, 'Whataburger'), false);
  });
});

describe('withDefaults', () => {
  it('returns the defaults for nothing stored', () => {
    assert.deepEqual(withDefaults(null), DEFAULT_PREFS);
    assert.deepEqual(withDefaults(undefined), DEFAULT_PREFS);
    assert.deepEqual(withDefaults({}), DEFAULT_PREFS);
  });

  it('keeps stored values', () => {
    const p = withDefaults({ digestTime: '08:30', leadMinutes: 0, mutedRestaurants: ['taco bell'] });
    assert.equal(p.digestTime, '08:30');
    assert.equal(p.leadMinutes, 0);
    assert.deepEqual(p.mutedRestaurants, ['taco bell']);
    assert.equal(p.expiryDaysBefore, DEFAULT_PREFS.expiryDaysBefore);
  });

  it('fills category keys added after the prefs were saved', () => {
    // Saved by a build that predates the delivery category.
    const stored = { categories: { freebie: false, app: true, deal: true, card: false } } as Partial<Prefs>;
    const p = withDefaults(stored);
    assert.deepEqual(p.categories, { freebie: false, app: true, deal: true, card: false, delivery: true });
  });

  it('fills fields added after the prefs were saved', () => {
    const old: Partial<Prefs> = { ...DEFAULT_PREFS, digestTime: '07:45' };
    delete old.refreshNudge;
    delete old.benefitDaysBefore;
    const p = withDefaults(old);
    assert.equal(p.refreshNudge, DEFAULT_PREFS.refreshNudge);
    assert.equal(p.benefitDaysBefore, DEFAULT_PREFS.benefitDaysBefore);
    assert.equal(p.digestTime, '07:45');
  });

  it('copies nested maps so edits do not leak into DEFAULT_PREFS', () => {
    const p = withDefaults(null);
    p.categories.app = false;
    p.dealOverrides.x = 'on';
    assert.equal(DEFAULT_PREFS.categories.app, true);
    assert.deepEqual(DEFAULT_PREFS.dealOverrides, {});
  });

  it('drops the retired per-issuer card choice', () => {
    const p = withDefaults({ cardVariants: { citi: 'citi-double-cash-card' } } as Partial<Prefs>);
    assert.equal('cardVariants' in p, false);
  });
});

describe('wantsBenefit', () => {
  const credit: Benefit = {
    id: 'gold-uber',
    card: 'amex-gold',
    title: '$10 Uber Cash',
    period: 'monthly',
    details: 'Monthly Uber Cash.',
    status: 'confirmed',
  };

  it('wants resetting credits that are not muted', () => {
    assert.equal(wantsBenefit(credit, DEFAULT_PREFS), true);
  });

  it('skips muted credits', () => {
    assert.equal(wantsBenefit(credit, prefs({ mutedBenefits: ['gold-uber'] })), false);
  });

  it('skips perks that never reset', () => {
    assert.equal(wantsBenefit({ ...credit, period: 'none' }, DEFAULT_PREFS), false);
  });
});
