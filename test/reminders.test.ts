import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { UsedCredits } from '../src/lib/benefits';
import { pad2, toYMD } from '../src/lib/dates';
import { DEFAULT_PREFS, type Prefs } from '../src/lib/prefs';
import {
  DEFAULT_MAX_REMINDERS,
  DIGEST_THRESHOLD,
  IOS_PENDING_LIMIT,
  planReminders,
  type Reminder,
} from '../src/lib/reminders';
import type { Benefit, Deal } from '../src/lib/schema';

// The phone lives in San Antonio; pin the zone so the Nov 1 DST change is exercised on any machine.
process.env.TZ = 'America/Chicago';

/** Sat Oct 24 2026, 08:00 local. */
const NOW = new Date(2026, 9, 24, 8, 0);
const TODAY = '2026-10-24';

function deal(over: Partial<Deal> & Pick<Deal, 'id'>): Deal {
  return {
    restaurant: 'Taco Bell',
    title: '$1 meal',
    category: 'deal',
    start: '2026-10-01',
    status: 'confirmed',
    ...over,
  };
}

function benefit(over: Partial<Benefit> & Pick<Benefit, 'id'>): Benefit {
  return {
    card: 'amex-gold',
    title: '$10 dining credit',
    period: 'monthly',
    details: 'Resets on the 1st.',
    status: 'confirmed',
    ...over,
  };
}

// Deal reminders only unless a test turns these on, so each test sees just what it is about.
// Weekly specials are opt-in in the app; most tests below exercise the planner's mechanics with
// them, so they opt in here. 'planReminders: default policy' covers the real defaults.
const BASE: Prefs = { ...DEFAULT_PREFS, weeklyPreview: false, refreshNudge: false, weeklyReminders: true };
const tacoOn = { dealOverrides: { 'tb-tue': 'on' as const } };

interface Options {
  deals?: Deal[];
  benefits?: Benefit[];
  prefs?: Partial<Prefs>;
  used?: UsedCredits;
  now?: Date;
  horizonDays?: number;
  max?: number;
}

function plan(o: Options = {}): Reminder[] {
  return planReminders({
    deals: o.deals ?? [],
    benefits: o.benefits ?? [],
    prefs: { ...BASE, ...o.prefs },
    used: o.used ?? {},
    now: o.now ?? NOW,
    horizonDays: o.horizonDays,
    max: o.max,
  });
}

/** 'kind YYYY-MM-DD HH:MM' in local time: the easiest shape to read in a failing diff. */
function when(r: Reminder): string {
  return `${r.kind} ${toYMD(r.fireAt)} ${pad2(r.fireAt.getHours())}:${pad2(r.fireAt.getMinutes())}`;
}
const whens = (rs: Reminder[]) => rs.map(when);
const ofKind = (rs: Reminder[], kind: Reminder['kind']) => rs.filter((r) => r.kind === kind);
const onDay = (rs: Reminder[], day: string) => rs.filter((r) => r.day === day);

// A realistic little week in San Antonio.
const tacoTuesday = deal({
  id: 'tb-tue',
  restaurant: 'Taco Bell',
  title: '$1 celebrity meal drop',
  category: 'app',
  channel: 'app',
  days: [2],
  startTime: '13:00',
  start: '2026-10-20',
  end: '2026-11-24',
});
const wendys = deal({
  id: 'wendys-mf',
  restaurant: 'Wendy’s',
  title: 'Free fries with any purchase',
  category: 'app',
  channel: 'app',
  days: [1, 5],
});
const shakeShack = deal({
  id: 'shack-scary',
  restaurant: 'Shake Shack',
  title: 'Free ShackBurger w/ $10+ order',
  channel: 'online',
  code: 'SCARYGOOD',
  start: '2026-10-26',
  end: '2026-11-05',
});
const panchitos = deal({
  id: 'panchitos',
  restaurant: 'Panchito’s',
  title: '1,000 free fajita plates',
  category: 'freebie',
  channel: 'in-store',
  local: true,
  location: 'Zarzamora St',
  start: TODAY,
  end: TODAY,
  startTime: '16:00',
  endTime: '18:00',
});
const signup = deal({ id: 'cfa-signup', restaurant: 'Chick-fil-A', title: 'Free nuggets for new members' });
const MIX = [tacoTuesday, wendys, shakeShack, panchitos, signup];

const goldDining = benefit({ id: 'gold-dining' });
const goldUber = benefit({ id: 'gold-uber', title: '$10 Uber Cash' });
const platUber = benefit({ id: 'plat-uber', card: 'amex-platinum', title: '$15 Uber Cash', amount: 15 });

describe('planReminders: master switch', () => {
  it('returns nothing when notifications are off', () => {
    const prefs = { notificationsEnabled: false, weeklyPreview: true, refreshNudge: true };
    assert.deepEqual(plan({ deals: MIX, benefits: [goldDining], prefs }), []);
  });
});

describe('planReminders: weekly deals', () => {
  const tuesdays = deal({ id: 'tue', days: [2], channel: 'app' });

  it('reminds at the digest time on each occurrence within the horizon', () => {
    const rs = plan({ deals: [tuesdays] });
    // Nov 3 and Nov 10 are after the Nov 1 fall-back and still fire at 9:00 local.
    assert.deepEqual(whens(rs), [
      'today 2026-10-27 09:00',
      'today 2026-11-03 09:00',
      'today 2026-11-10 09:00',
    ]);
    assert.equal(rs[0].id, 'today:tue:2026-10-27');
    assert.equal(rs[0].title, 'Today: Taco Bell');
    assert.equal(rs[0].body, '$1 meal · In the app');
    assert.equal(rs[0].dealId, 'tue');
    assert.equal(rs[0].day, '2026-10-27');
  });

  it('follows the digest time setting', () => {
    const rs = plan({ deals: [tuesdays], prefs: { digestTime: '07:30' }, horizonDays: 7 });
    assert.deepEqual(whens(rs), ['today 2026-10-27 07:30']);
  });

  it('includes today when it has not passed yet', () => {
    const saturdays = deal({ id: 'sat', days: [6] });
    assert.deepEqual(whens(plan({ deals: [saturdays], horizonDays: 7 })), [
      'today 2026-10-24 09:00',
      'today 2026-10-31 09:00',
    ]);
  });

  it('counts the horizon inclusively and stops at it', () => {
    assert.deepEqual(whens(plan({ deals: [tuesdays], horizonDays: 2 })), []);
    assert.deepEqual(whens(plan({ deals: [tuesdays], horizonDays: 3 })), ['today 2026-10-27 09:00']);
  });

  it('stops after the end date', () => {
    const rs = plan({ deals: [{ ...tuesdays, end: '2026-11-03' }] });
    assert.deepEqual(whens(rs), ['today 2026-10-27 09:00', 'today 2026-11-03 09:00']);
  });

  it('says nothing about a deal that already ended', () => {
    assert.deepEqual(plan({ deals: [{ ...tuesdays, end: '2026-10-23' }] }), []);
  });
});

describe('planReminders: timed deals', () => {
  it('adds a heads-up leadMinutes before the start time', () => {
    const rs = plan({ deals: [tacoTuesday], horizonDays: 7, prefs: tacoOn });
    assert.deepEqual(whens(rs), ['today 2026-10-27 09:00', 'heads-up 2026-10-27 12:45']);
    const [today, heads] = rs;
    assert.equal(today.body, '$1 celebrity meal drop · 1 PM · In the app');
    assert.equal(heads.id, 'heads-up:tb-tue:2026-10-27');
    assert.equal(heads.title, 'Taco Bell in 15 min');
    assert.equal(heads.body, '$1 celebrity meal drop starts at 1 PM · In the app');
    assert.equal(heads.dealId, 'tb-tue');
  });

  it('uses the configured lead time', () => {
    const rs = plan({ deals: [tacoTuesday], horizonDays: 7, prefs: { ...tacoOn, leadMinutes: 30 } });
    assert.deepEqual(whens(ofKind(rs, 'heads-up')), ['heads-up 2026-10-27 12:30']);
    assert.equal(ofKind(rs, 'heads-up')[0].title, 'Taco Bell in 30 min');
  });

  it('drops the morning reminder when it falls within 60 minutes of the heads-up', () => {
    const at = (digestTime: string) =>
      whens(plan({ deals: [tacoTuesday], horizonDays: 7, prefs: { ...tacoOn, digestTime } }));
    assert.deepEqual(at('12:00'), ['heads-up 2026-10-27 12:45']);
    assert.deepEqual(at('11:45'), ['heads-up 2026-10-27 12:45']);
    assert.deepEqual(at('11:44'), ['today 2026-10-27 11:44', 'heads-up 2026-10-27 12:45']);
  });

  it('sends no heads-up when leadMinutes is 0', () => {
    const rs = plan({
      deals: [tacoTuesday],
      horizonDays: 7,
      prefs: { ...tacoOn, leadMinutes: 0, digestTime: '12:00' },
    });
    assert.deepEqual(whens(rs), ['today 2026-10-27 12:00']);
  });

  it('gives a multi-day promo no heads-up (its daily window would ping every day)', () => {
    const lunch = deal({ id: 'lunch', start: '2026-10-26', end: '2026-10-30', startTime: '11:00' });
    assert.deepEqual(whens(ofKind(plan({ deals: [lunch] }), 'heads-up')), []);
  });

  it('gives a weekly special a heads-up only when it is switched to Always', () => {
    assert.deepEqual(ofKind(plan({ deals: [tacoTuesday], horizonDays: 7 }), 'heads-up'), []);
    assert.equal(ofKind(plan({ deals: [tacoTuesday], horizonDays: 7, prefs: tacoOn }), 'heads-up').length, 1);
  });

  it('reminds early for deals that end before or just after the digest time', () => {
    const at = (over: Partial<Deal>) => {
      const bk = deal({ id: 'bk', days: [2], ...over });
      return whens(plan({ deals: [bk], horizonDays: 7, prefs: { leadMinutes: 0 } }));
    };
    // 30 minutes before the start, but never before 7 AM.
    assert.deepEqual(at({ startTime: '08:00', endTime: '09:15' }), ['today 2026-10-27 07:30']);
    assert.deepEqual(at({ startTime: '06:00', endTime: '09:30' }), ['today 2026-10-27 07:00']);
    assert.deepEqual(at({ endTime: '09:00' }), ['today 2026-10-27 07:00']);
    assert.deepEqual(at({ startTime: '06:00', endTime: '10:30' }), ['today 2026-10-27 09:00']);
  });
});

describe('planReminders: one-day deals', () => {
  it('reminds once on the day', () => {
    const rs = plan({ deals: [deal({ id: 'mon', start: '2026-10-26', end: '2026-10-26' })] });
    assert.deepEqual(whens(rs), ['today 2026-10-26 09:00']);
    assert.equal(rs[0].title, 'Today only: Taco Bell');
    assert.equal(rs[0].id, 'today:mon:2026-10-26');
  });

  it('includes how to redeem and a heads-up for a timed local event today', () => {
    const rs = plan({ deals: [panchitos] });
    assert.deepEqual(whens(rs), ['today 2026-10-24 09:00', 'heads-up 2026-10-24 15:45']);
    assert.equal(rs[0].title, 'Today only: Panchito’s');
    assert.equal(rs[0].body, '1,000 free fajita plates · 4 PM · In store · Zarzamora St');
    assert.equal(rs[1].title, 'Panchito’s in 15 min');
    assert.equal(rs[1].body, '1,000 free fajita plates starts at 4 PM · In store · Zarzamora St');
  });
});

describe('planReminders: multi-day promos', () => {
  it('reminds when it starts, expiryDaysBefore days before the end, and on the last day', () => {
    const rs = plan({ deals: [shakeShack] });
    assert.deepEqual(whens(rs), [
      'starts 2026-10-26 09:00',
      'ending 2026-11-04 09:00',
      'last-day 2026-11-05 09:00',
    ]);
    assert.deepEqual(
      rs.map((r) => r.title),
      ['Starts today: Shake Shack', 'Ends tomorrow: Shake Shack', 'Last day: Shake Shack'],
    );
    const what = 'Free ShackBurger w/ $10+ order · Online order · code SCARYGOOD';
    assert.equal(rs[0].body, `${what} · through Nov 5`);
    assert.equal(rs[2].body, what);
    assert.deepEqual(
      rs.map((r) => r.id),
      ['starts:shack-scary:2026-10-26', 'ending:shack-scary:2026-11-04', 'last-day:shack-scary:2026-11-05'],
    );
  });

  it('moves the ending reminder with expiryDaysBefore', () => {
    const rs = plan({ deals: [shakeShack], prefs: { expiryDaysBefore: 3 } });
    assert.deepEqual(whens(rs), [
      'starts 2026-10-26 09:00',
      'ending 2026-11-02 09:00',
      'last-day 2026-11-05 09:00',
    ]);
    assert.equal(rs[1].title, 'Ends in 3 days: Shake Shack');
  });

  it('only marks the last day when expiryDaysBefore is 0', () => {
    const rs = plan({ deals: [shakeShack], prefs: { expiryDaysBefore: 0 } });
    assert.deepEqual(whens(rs), ['starts 2026-10-26 09:00', 'last-day 2026-11-05 09:00']);
  });

  it('says nothing on the end day when expiryDaysBefore is -1', () => {
    const rs = plan({ deals: [shakeShack], prefs: { expiryDaysBefore: -1 } });
    assert.deepEqual(whens(rs), ['starts 2026-10-26 09:00']);
  });

  it('skips the start reminder for a promo that is already running', () => {
    const running = { ...shakeShack, start: '2026-10-20' };
    assert.deepEqual(whens(plan({ deals: [running] })), [
      'ending 2026-11-04 09:00',
      'last-day 2026-11-05 09:00',
    ]);
  });

  it('marks today as the last day of a promo ending today', () => {
    const endsToday = deal({ id: 'ends', start: '2026-10-20', end: TODAY });
    assert.deepEqual(whens(plan({ deals: [endsToday] })), ['last-day 2026-10-24 09:00']);
  });

  it('stays quiet through the middle of a long promo', () => {
    const long = deal({ id: 'long', start: '2026-10-01', end: '2026-12-31' });
    assert.deepEqual(plan({ deals: [long] }), []);
  });
});

describe('planReminders: ongoing deals', () => {
  it('produces no deal reminders', () => {
    const later = deal({ id: 'later', start: '2026-10-28' });
    assert.deepEqual(plan({ deals: [signup, later], prefs: { weeklyPreview: true } }), []);
  });

  it('produces no heads-up either, even when the perk has a start time', () => {
    // An ongoing deal is "every day from start", so a single first-day heads-up would be misleading.
    const happyHour = deal({ id: 'happy-hour', start: '2026-10-28', startTime: '14:00', endTime: '16:00' });
    assert.deepEqual(whens(plan({ deals: [happyHour] })), []);
  });
});

describe('planReminders: digest', () => {
  const tue = (id: string, restaurant: string, over: Partial<Deal> = {}) =>
    deal({ id, restaurant, title: `${restaurant} deal`, days: [2], ...over });

  it(`collapses ${DIGEST_THRESHOLD}+ same-time reminders on one day into one digest`, () => {
    assert.equal(DIGEST_THRESHOLD, 3);
    const deals = [tue('a', 'Taco Bell'), tue('b', 'Wendy’s'), tue('c', 'Whataburger')];
    const rs = plan({ deals, horizonDays: 3 });
    assert.deepEqual(whens(rs), ['digest 2026-10-27 09:00']);
    const [digest] = rs;
    assert.equal(digest.id, 'digest:2026-10-27');
    assert.equal(digest.title, 'Tuesday: 3 deals for you');
    assert.deepEqual(digest.body.split('\n'), [
      'Taco Bell: Taco Bell deal',
      'Wendy’s: Wendy’s deal',
      'Whataburger: Whataburger deal',
    ]);
    assert.equal(digest.dealId, undefined);
  });

  it('keeps two same-time reminders separate', () => {
    const rs = plan({ deals: [tue('a', 'Taco Bell'), tue('b', 'Wendy’s')], horizonDays: 3 });
    assert.deepEqual(whens(rs), ['today 2026-10-27 09:00', 'today 2026-10-27 09:00']);
    assert.deepEqual(rs.map((r) => r.dealId), ['a', 'b']);
  });

  it('lists last days first and counts them in the title', () => {
    const ending = deal({
      id: 'shack',
      restaurant: 'Shake Shack',
      title: 'Free burger',
      start: '2026-10-20',
      end: '2026-10-27',
    });
    const rs = plan({ deals: [tue('a', 'Taco Bell'), tue('b', 'Wendy’s'), ending], horizonDays: 3 });
    // The day before the end is still its own reminder.
    assert.deepEqual(whens(onDay(rs, '2026-10-26')), ['ending 2026-10-26 09:00']);
    const [digest] = onDay(rs, '2026-10-27');
    assert.equal(digest.kind, 'digest');
    assert.equal(digest.title, 'Tuesday: 3 deals for you · 1 ending');
    assert.equal(digest.body.split('\n')[0], 'Last day · Shake Shack: Free burger');
  });

  it('leaves heads-ups out of the digest', () => {
    const rs = plan({
      deals: [tue('a', 'Taco Bell', { startTime: '13:00' }), tue('b', 'Wendy’s'), tue('c', 'Whataburger')],
      horizonDays: 3,
      prefs: { dealOverrides: { a: 'on' } },
    });
    assert.deepEqual(whens(rs), ['digest 2026-10-27 09:00', 'heads-up 2026-10-27 12:45']);
    assert.equal(rs[0].body.split('\n')[0], 'Taco Bell: Taco Bell deal · 1 PM');
  });

  it('only counts reminders that fire at the digest time', () => {
    const breakfast = tue('bk', 'Whataburger', { startTime: '06:00', endTime: '09:00' });
    const rs = plan({
      deals: [tue('a', 'Taco Bell'), tue('b', 'Wendy’s'), breakfast],
      horizonDays: 3,
      prefs: { dealOverrides: { bk: 'on' } },
    });
    assert.deepEqual(whens(rs), [
      'heads-up 2026-10-27 05:45',
      'today 2026-10-27 07:00',
      'today 2026-10-27 09:00',
      'today 2026-10-27 09:00',
    ]);
  });
});

describe('planReminders: filters', () => {
  it('ignores hidden deals', () => {
    assert.deepEqual(plan({ deals: [tacoTuesday], prefs: { hiddenDeals: ['tb-tue'] } }), []);
  });

  it('ignores muted restaurants, even for a deal switched to Always', () => {
    assert.deepEqual(plan({ deals: [tacoTuesday], prefs: { mutedRestaurants: ['taco bell'] } }), []);
    const always = { mutedRestaurants: ['taco bell'], dealOverrides: { 'tb-tue': 'on' as const } };
    assert.deepEqual(plan({ deals: [tacoTuesday], prefs: always }), []);
  });

  it('ignores categories that are switched off', () => {
    const categories = { ...DEFAULT_PREFS.categories, freebie: false };
    assert.deepEqual(plan({ deals: [panchitos], prefs: { categories } }), []);
    assert.ok(plan({ deals: [tacoTuesday], prefs: { categories } }).length > 0);
  });

  it('ignores deals switched off by hand', () => {
    assert.deepEqual(plan({ deals: [tacoTuesday], prefs: { dealOverrides: { 'tb-tue': 'off' } } }), []);
  });

  it('filters unconfirmed deals when includeUnconfirmed is false', () => {
    const unconfirmed = { ...tacoTuesday, status: 'unconfirmed' as const };
    assert.deepEqual(plan({ deals: [unconfirmed], prefs: { includeUnconfirmed: false } }), []);
    assert.ok(plan({ deals: [unconfirmed], prefs: { includeUnconfirmed: true } }).length > 0);
    assert.ok(plan({ deals: [tacoTuesday], prefs: { includeUnconfirmed: false } }).length > 0);
  });
});

describe('planReminders: card credits', () => {
  it('warns benefitDaysBefore days before a monthly reset and again on the last day', () => {
    const rs = plan({ benefits: [goldDining] });
    assert.deepEqual(whens(rs), ['credits 2026-10-28 09:00', 'credits 2026-10-31 09:00']);
    const [warn, last] = rs;
    assert.equal(warn.id, 'credits:2026-10-28:warn');
    assert.equal(warn.title, 'Amex Gold: $10 dining credit resets in 3 days');
    assert.equal(warn.body, 'Gold: $10 dining credit');
    assert.deepEqual(warn.benefitIds, ['gold-dining']);
    assert.equal(last.id, 'credits:2026-10-31:last');
    assert.equal(last.title, 'Amex Gold: $10 dining credit resets tonight');
    assert.equal(last.body, 'Gold: $10 dining credit — use it or lose it.');
  });

  it('groups credits that reset on the same day into one notification', () => {
    const rs = plan({ benefits: [goldDining, goldUber, platUber] });
    assert.deepEqual(whens(rs), ['credits 2026-10-28 09:00', 'credits 2026-10-31 09:00']);
    const last = rs[1];
    assert.equal(last.title, '3 card credits reset tonight');
    assert.equal(
      last.body,
      'Gold: $10 dining credit · Gold: $10 Uber Cash · Plat: $15 Uber Cash — use it or lose it.',
    );
    assert.deepEqual(last.benefitIds, ['gold-dining', 'gold-uber', 'plat-uber']);
    assert.equal(rs[0].title, '3 card credits reset in 3 days');
  });

  it('keeps different reset days apart and groups the shared ones', () => {
    const quarterly = benefit({ id: 'citi-q', card: 'citi', title: '$25 dining', period: 'quarterly' });
    const rs = plan({ benefits: [goldDining, quarterly], horizonDays: 70 });
    assert.deepEqual(whens(rs), [
      'credits 2026-10-28 09:00',
      'credits 2026-10-31 09:00',
      'credits 2026-11-27 09:00',
      'credits 2026-11-30 09:00',
      'credits 2026-12-28 09:00',
      'credits 2026-12-31 09:00',
    ]);
    assert.deepEqual(rs[5].benefitIds, ['gold-dining', 'citi-q']);
    assert.equal(rs[5].title, '2 card credits reset tonight');
  });

  it('skips a credit marked used this period but reminds again next period', () => {
    const used = { 'gold-dining': '2026-10' };
    assert.deepEqual(plan({ benefits: [goldDining], used }), []);
    assert.deepEqual(whens(plan({ benefits: [goldDining], used, horizonDays: 40 })), [
      'credits 2026-11-27 09:00',
      'credits 2026-11-30 09:00',
    ]);
  });

  it('still reminds when only an older period was marked used', () => {
    assert.equal(plan({ benefits: [goldDining], used: { 'gold-dining': '2026-09' } }).length, 2);
  });

  it('only reminds about the unused credits in a group', () => {
    const rs = plan({ benefits: [goldDining, goldUber], used: { 'gold-uber': '2026-10' } });
    assert.deepEqual(rs.map((r) => r.benefitIds), [['gold-dining'], ['gold-dining']]);
  });

  it('follows benefitDaysBefore', () => {
    assert.deepEqual(plan({ benefits: [goldDining], prefs: { benefitDaysBefore: -1 } }), []);
    assert.deepEqual(whens(plan({ benefits: [goldDining], prefs: { benefitDaysBefore: 0 } })), [
      'credits 2026-10-31 09:00',
    ]);
    const one = plan({ benefits: [goldDining], prefs: { benefitDaysBefore: 1 } });
    assert.deepEqual(whens(one), ['credits 2026-10-30 09:00', 'credits 2026-10-31 09:00']);
    assert.equal(one[0].title, 'Amex Gold: $10 dining credit resets in 1 day');
  });

  it('skips muted credits and perks that never reset', () => {
    assert.deepEqual(plan({ benefits: [goldDining], prefs: { mutedBenefits: ['gold-dining'] } }), []);
    assert.deepEqual(plan({ benefits: [benefit({ id: 'lounge', period: 'none' })] }), []);
  });

  it('drops a warning whose day has already passed', () => {
    const now = new Date(2026, 9, 30, 8, 0);
    assert.deepEqual(whens(plan({ benefits: [goldDining], now })), ['credits 2026-10-31 09:00']);
  });

  it('fires at the digest time', () => {
    const rs = plan({ benefits: [goldDining], prefs: { digestTime: '08:30' } });
    assert.deepEqual(whens(rs), ['credits 2026-10-28 08:30', 'credits 2026-10-31 08:30']);
  });
});

describe('planReminders: weekly preview', () => {
  it('previews the coming week on Sundays at 6 PM, restaurants by weekday', () => {
    const rs = ofKind(plan({ deals: MIX, prefs: { weeklyPreview: true } }), 'week-preview');
    assert.deepEqual(whens(rs), [
      'week-preview 2026-10-25 18:00',
      'week-preview 2026-11-01 18:00',
      'week-preview 2026-11-08 18:00',
    ]);
    assert.equal(rs[0].id, 'week-preview:2026-10-25');
    assert.equal(rs[0].title, 'Your deal week ahead');
    // Long promos show on their first and last day only; ongoing perks never.
    assert.equal(rs[0].body, 'Mon: Wendy’s, Shake Shack\nTue: Taco Bell\nFri: Wendy’s');
    assert.equal(rs[1].body, 'Mon: Wendy’s\nTue: Taco Bell\nThu: Shake Shack\nFri: Wendy’s');
  });

  it('shows each restaurant once and caps a day at three names', () => {
    const tue = (id: string, restaurant: string) => deal({ id, restaurant, days: [2] });
    const deals = [
      tue('a', 'Taco Bell'),
      tue('a2', 'Taco Bell'),
      tue('b', 'Wendy’s'),
      tue('c', 'Whataburger'),
      tue('d', 'Sonic'),
      tue('e', 'Popeyes'),
    ];
    const [preview] = ofKind(plan({ deals, prefs: { weeklyPreview: true }, horizonDays: 7 }), 'week-preview');
    assert.equal(preview.body, 'Tue: Taco Bell, Wendy’s, Whataburger +2');
  });

  it('skips a Sunday when nothing is coming up that week', () => {
    const thursday = deal({ id: 'thu', start: '2026-10-29', end: '2026-10-29' });
    const rs = ofKind(plan({ deals: [thursday], prefs: { weeklyPreview: true } }), 'week-preview');
    assert.deepEqual(whens(rs), ['week-preview 2026-10-25 18:00']);
    assert.equal(rs[0].body, 'Thu: Taco Bell');
  });

  it('leaves hidden and muted deals out', () => {
    const prefs = { weeklyPreview: true, hiddenDeals: ['wendys-mf'], mutedRestaurants: ['shake shack'] };
    const [preview] = ofKind(plan({ deals: MIX, prefs }), 'week-preview');
    assert.equal(preview.body, 'Tue: Taco Bell');
  });

  it('includes today when today is Sunday', () => {
    const now = new Date(2026, 9, 25, 8, 0);
    const rs = plan({ deals: MIX, prefs: { weeklyPreview: true }, now, horizonDays: 6 });
    assert.deepEqual(whens(ofKind(rs, 'week-preview')), ['week-preview 2026-10-25 18:00']);
  });

  it('is off when weeklyPreview is false', () => {
    assert.deepEqual(ofKind(plan({ deals: MIX }), 'week-preview'), []);
  });
});

describe('planReminders: refresh nudge', () => {
  it('nudges every Monday at 10 AM within the horizon', () => {
    const rs = plan({ prefs: { refreshNudge: true } });
    assert.deepEqual(whens(rs), [
      'refresh 2026-10-26 10:00',
      'refresh 2026-11-02 10:00',
      'refresh 2026-11-09 10:00',
    ]);
    assert.equal(rs[0].id, 'refresh:2026-10-26');
    assert.equal(rs[0].title, 'Time for your weekly deal search');
  });

  it('is off when refreshNudge is false', () => {
    assert.deepEqual(plan({ deals: MIX }).filter((r) => r.kind === 'refresh'), []);
  });
});

describe('planReminders: timing, order and limits', () => {
  it('drops anything due before now plus a minute', () => {
    const today = deal({ id: 'today', start: TODAY, end: TODAY });
    const at = (digestTime: string) => whens(plan({ deals: [today], prefs: { digestTime } }));
    assert.deepEqual(at('07:30'), []);
    assert.deepEqual(at('08:00'), []);
    assert.deepEqual(at('08:01'), []);
    assert.deepEqual(at('08:02'), ['today 2026-10-24 08:02']);
  });

  it('drops an earlier heads-up today but keeps tomorrow\'s', () => {
    const daily = deal({ id: 'early', days: [0, 1, 2, 3, 4, 5, 6], startTime: '08:10' });
    const rs = ofKind(plan({ deals: [daily], horizonDays: 1, prefs: { dealOverrides: { early: 'on' } } }), 'heads-up');
    assert.deepEqual(whens(rs), ['heads-up 2026-10-25 07:55']);
  });

  it('sorts by fire time, then id', () => {
    const rs = plan({
      deals: MIX,
      benefits: [goldDining, goldUber, platUber],
      prefs: { weeklyPreview: true, refreshNudge: true },
      horizonDays: 40,
      max: 1000,
    });
    assert.ok(rs.length > 20);
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1];
      const b = rs[i];
      const dt = b.fireAt.getTime() - a.fireAt.getTime();
      assert.ok(dt > 0 || (dt === 0 && a.id < b.id), `${a.id} should come before ${b.id}`);
    }
  });

  it('keeps the soonest reminders when capped at max', () => {
    const prefs = { weeklyPreview: true, refreshNudge: true };
    const options = { deals: MIX, benefits: [goldDining], prefs };
    const all = plan({ ...options, max: 1000 });
    const capped = plan({ ...options, max: 5 });
    assert.equal(capped.length, 5);
    assert.deepEqual(capped, all.slice(0, 5));
  });

  it(`caps at ${DEFAULT_MAX_REMINDERS} by default, under the iOS limit`, () => {
    const everyDay = [0, 1, 2, 3, 4, 5, 6];
    const deals = [
      deal({ id: 'lunch', days: everyDay, startTime: '13:00' }),
      deal({ id: 'dinner', restaurant: 'Wendy’s', days: everyDay, startTime: '17:00' }),
    ];
    const prefs = { dealOverrides: { lunch: 'on' as const, dinner: 'on' as const } };
    const all = plan({ deals, prefs, max: 1000 });
    assert.ok(all.length > DEFAULT_MAX_REMINDERS);
    const capped = plan({ deals, prefs });
    assert.equal(capped.length, DEFAULT_MAX_REMINDERS);
    assert.ok(capped.length <= IOS_PENDING_LIMIT);
    assert.deepEqual(capped, all.slice(0, DEFAULT_MAX_REMINDERS));
  });

  it('gives every reminder a unique, stable id', () => {
    const options = {
      deals: MIX,
      benefits: [goldDining, goldUber, platUber],
      prefs: { weeklyPreview: true, refreshNudge: true },
      horizonDays: 40,
      max: 1000,
    };
    const ids = plan(options).map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(plan(options).map((r) => r.id), ids);
  });

  it('plans a sensible first week for the sample deals', () => {
    const rs = plan({
      deals: MIX,
      benefits: [goldDining, goldUber],
      prefs: { weeklyPreview: true, refreshNudge: true },
      horizonDays: 7,
    });
    assert.deepEqual(whens(rs), [
      'today 2026-10-24 09:00',
      'heads-up 2026-10-24 15:45',
      'week-preview 2026-10-25 18:00',
      'starts 2026-10-26 09:00',
      'today 2026-10-26 09:00',
      'refresh 2026-10-26 10:00',
      'today 2026-10-27 09:00',
      'credits 2026-10-28 09:00',
      'today 2026-10-30 09:00',
      'credits 2026-10-31 09:00',
    ]);
  });
});

describe('planReminders: default policy', () => {
  // The app's real defaults: weekly specials are opt-in.
  const defaults = (o: Options = {}) =>
    planReminders({
      deals: o.deals ?? [],
      benefits: o.benefits ?? [],
      prefs: { ...DEFAULT_PREFS, weeklyPreview: false, refreshNudge: false, ...o.prefs },
      used: o.used ?? {},
      now: o.now ?? NOW,
      horizonDays: o.horizonDays,
    });

  it('keeps weekly specials quiet unless weeklyReminders is on or the deal is switched to Always', () => {
    assert.equal(DEFAULT_PREFS.weeklyReminders, false);
    assert.deepEqual(defaults({ deals: [tacoTuesday, wendys] }), []);
    const on = defaults({ deals: [tacoTuesday, wendys], prefs: tacoOn, horizonDays: 7 });
    assert.deepEqual(whens(on), ['today 2026-10-27 09:00', 'heads-up 2026-10-27 12:45']);
    const all = defaults({ deals: [tacoTuesday, wendys], prefs: { weeklyReminders: true }, horizonDays: 7 });
    assert.deepEqual(new Set(all.map((r) => r.dealId)), new Set(['tb-tue', 'wendys-mf']));
    assert.deepEqual(ofKind(all, 'heads-up'), []);
  });

  it('still notifies time-limited deals by default', () => {
    const rs = defaults({ deals: [shakeShack, panchitos] });
    assert.deepEqual(whens(rs), [
      'today 2026-10-24 09:00',
      'heads-up 2026-10-24 15:45',
      'starts 2026-10-26 09:00',
      'ending 2026-11-04 09:00',
      'last-day 2026-11-05 09:00',
    ]);
  });

  it('only announces a start that was known before the deal began', () => {
    const foundRunning = { ...shakeShack, firstSeen: '2026-10-26' };
    assert.deepEqual(ofKind(defaults({ deals: [foundRunning] }), 'starts'), []);
    const foundEarly = { ...shakeShack, firstSeen: '2026-10-20' };
    assert.equal(ofKind(defaults({ deals: [foundEarly] }), 'starts').length, 1);
  });

  it('lists weekly specials in the Sunday preview even when they do not ping', () => {
    const rs = defaults({ deals: [tacoTuesday], prefs: { weeklyPreview: true }, horizonDays: 7 });
    assert.deepEqual(whens(rs), ['week-preview 2026-10-25 18:00']);
    assert.match(rs[0].body, /^Tue: Taco Bell$/m);
  });

  it('skips credits for cards the user does not hold', () => {
    const credit = (cardName?: string) =>
      defaults({ benefits: [benefit({ id: 'c1', card: 'capital-one', cardName, title: '$10 credit' })] });
    assert.deepEqual(credit('Capital One Savor'), []);
    assert.ok(credit('Capital One Quicksilver').length > 0);
    // No cardName: it comes with every Capital One card, Quicksilver included.
    assert.ok(credit(undefined).length > 0);
  });

  it('keeps a credit warning inside the horizon even when the reset itself is past it', () => {
    // Nov 7 + 21 days = Nov 28: the Nov 27 warning fits, the Nov 30 reset does not.
    const rs = defaults({ benefits: [goldDining], now: new Date(2026, 10, 7, 8, 0) });
    assert.deepEqual(whens(rs), ['credits 2026-11-27 09:00']);
  });
});
