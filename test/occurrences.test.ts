import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareDeals,
  dealKind,
  dealsOn,
  isCalendarDay,
  isOneDay,
  isOver,
  LONG_PROMO_DAYS,
  nextOccurrence,
  occursOn,
  spanDays,
} from '../src/lib/occurrences';
import type { Deal } from '../src/lib/schema';

// Sat Oct 24 2026 is "today" throughout.
function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: 'd',
    restaurant: 'Taco Bell',
    title: '$1 meal',
    category: 'deal',
    start: '2026-10-01',
    status: 'confirmed',
    ...over,
  };
}

const tacoTuesday = deal({ id: 'tue', days: [2], start: '2026-10-20', end: '2026-11-17' });
const promo = deal({ id: 'promo', start: '2026-10-20', end: '2026-10-31' });
const oneDay = deal({ id: 'one', start: '2026-10-29', end: '2026-10-29' });
const ongoing = deal({ id: 'ongoing', start: '2026-09-01' });

describe('dealKind', () => {
  it('is weekly when days are set, even with an end date', () => {
    assert.equal(dealKind(tacoTuesday), 'weekly');
    assert.equal(dealKind(deal({ days: [1, 5] })), 'weekly');
  });

  it('is dated when there is an end and no days', () => {
    assert.equal(dealKind(promo), 'dated');
    assert.equal(dealKind(oneDay), 'dated');
    assert.equal(dealKind(deal({ end: '2026-10-31', days: [] })), 'dated');
  });

  it('is ongoing with no end and no days', () => {
    assert.equal(dealKind(ongoing), 'ongoing');
    assert.equal(dealKind(deal({ days: [] })), 'ongoing');
  });
});

describe('occursOn', () => {
  it('respects the start and end dates', () => {
    assert.equal(occursOn(promo, '2026-10-19'), false);
    assert.equal(occursOn(promo, '2026-10-20'), true);
    assert.equal(occursOn(promo, '2026-10-25'), true);
    assert.equal(occursOn(promo, '2026-10-31'), true);
    assert.equal(occursOn(promo, '2026-11-01'), false);
  });

  it('only matches the listed weekdays', () => {
    assert.equal(occursOn(tacoTuesday, '2026-10-20'), true);
    assert.equal(occursOn(tacoTuesday, '2026-10-21'), false);
    assert.equal(occursOn(tacoTuesday, '2026-10-24'), false);
    assert.equal(occursOn(tacoTuesday, '2026-10-27'), true);
    assert.equal(occursOn(tacoTuesday, '2026-11-17'), true);
    assert.equal(occursOn(tacoTuesday, '2026-11-24'), false);
  });

  it('does not run before a weekly deal starts', () => {
    const later = deal({ days: [2], start: '2026-10-28' });
    assert.equal(occursOn(later, '2026-10-27'), false);
    assert.equal(occursOn(later, '2026-11-03'), true);
  });

  it('keeps an ongoing deal running indefinitely', () => {
    assert.equal(occursOn(ongoing, '2026-08-31'), false);
    assert.equal(occursOn(ongoing, '2026-09-01'), true);
    assert.equal(occursOn(ongoing, '2030-01-01'), true);
  });
});

describe('isOver / spanDays / isOneDay', () => {
  it('is over only after the end date', () => {
    assert.equal(isOver(promo, '2026-10-31'), false);
    assert.equal(isOver(promo, '2026-11-01'), true);
    assert.equal(isOver(ongoing, '2030-01-01'), false);
  });

  it('measures the span in days', () => {
    assert.equal(spanDays(oneDay), 0);
    assert.equal(spanDays(promo), 11);
    assert.equal(spanDays(ongoing), undefined);
  });

  it('recognizes one-day deals', () => {
    assert.equal(isOneDay(oneDay), true);
    assert.equal(isOneDay(promo), false);
    assert.equal(isOneDay(ongoing), false);
    // A weekly deal that happens to start and end on the same day is still weekly.
    assert.equal(isOneDay(deal({ days: [4], start: '2026-10-29', end: '2026-10-29' })), false);
  });
});

describe('isCalendarDay', () => {
  it('marks weekly deals on their weekdays only', () => {
    assert.equal(isCalendarDay(tacoTuesday, '2026-10-27'), true);
    assert.equal(isCalendarDay(tacoTuesday, '2026-10-28'), false);
    assert.equal(isCalendarDay(tacoTuesday, '2026-11-24'), false);
  });

  it(`marks short promos (span <= ${LONG_PROMO_DAYS}) on every day`, () => {
    const short = deal({ start: '2026-10-24', end: '2026-10-30' });
    assert.equal(spanDays(short), LONG_PROMO_DAYS);
    for (const day of ['2026-10-24', '2026-10-25', '2026-10-27', '2026-10-30']) {
      assert.equal(isCalendarDay(short, day), true, day);
    }
    assert.equal(isCalendarDay(short, '2026-10-31'), false);
    assert.equal(isCalendarDay(oneDay, '2026-10-29'), true);
  });

  it('marks long promos only on their first and last day', () => {
    const long = deal({ start: '2026-10-24', end: '2026-10-31' });
    assert.equal(spanDays(long), LONG_PROMO_DAYS + 1);
    assert.equal(isCalendarDay(long, '2026-10-24'), true);
    assert.equal(isCalendarDay(long, '2026-10-25'), false);
    assert.equal(isCalendarDay(long, '2026-10-28'), false);
    assert.equal(isCalendarDay(long, '2026-10-31'), true);
    assert.equal(isCalendarDay(long, '2026-11-01'), false);
  });

  it('never marks ongoing deals', () => {
    assert.equal(isCalendarDay(ongoing, '2026-09-01'), false);
    assert.equal(isCalendarDay(ongoing, '2026-10-24'), false);
  });
});

describe('nextOccurrence', () => {
  it('finds the next matching weekday', () => {
    assert.equal(nextOccurrence(tacoTuesday, '2026-10-24'), '2026-10-27');
    assert.equal(nextOccurrence(tacoTuesday, '2026-10-27'), '2026-10-27');
    assert.equal(nextOccurrence(tacoTuesday, '2026-10-28'), '2026-11-03');
  });

  it('returns undefined once the deal has ended', () => {
    assert.equal(nextOccurrence(tacoTuesday, '2026-11-18'), undefined);
    assert.equal(nextOccurrence(promo, '2026-11-01'), undefined);
  });

  it('jumps ahead to a future start', () => {
    assert.equal(nextOccurrence(oneDay, '2026-10-24'), '2026-10-29');
    assert.equal(nextOccurrence(deal({ days: [2], start: '2026-11-01' }), '2026-10-24'), '2026-11-03');
  });

  it('returns today for running dated and ongoing deals', () => {
    assert.equal(nextOccurrence(promo, '2026-10-24'), '2026-10-24');
    assert.equal(nextOccurrence(ongoing, '2026-10-24'), '2026-10-24');
  });

  it('gives up after the horizon', () => {
    assert.equal(nextOccurrence(tacoTuesday, '2026-10-28', 5), undefined);
    assert.equal(nextOccurrence(tacoTuesday, '2026-10-28', 6), '2026-11-03');
  });
});

describe('compareDeals / dealsOn', () => {
  const at1 = deal({ id: 'a', restaurant: 'Wendy’s', startTime: '13:00' });
  const at10 = deal({ id: 'b', restaurant: 'Zaxby’s', startTime: '10:30' });
  const untimedA = deal({ id: 'c', restaurant: 'Arby’s', title: 'Free fries' });
  const untimedB = deal({ id: 'd', restaurant: 'Arby’s', title: 'BOGO sliders' });
  const untimedZ = deal({ id: 'e', restaurant: 'Whataburger' });

  it('puts timed deals first, earliest first, then sorts by restaurant and title', () => {
    const sorted = [untimedZ, untimedA, at1, untimedB, at10].sort(compareDeals).map((d) => d.id);
    assert.deepEqual(sorted, ['b', 'a', 'd', 'c', 'e']);
  });

  it('returns 0 for equivalent deals', () => {
    assert.equal(compareDeals(untimedA, { ...untimedA, id: 'copy' }), 0);
  });

  it('lists only the deals running on a day, in display order', () => {
    const list = dealsOn(
      [
        deal({ id: 'whata', restaurant: 'Whataburger', days: [2] }),
        deal({ id: 'arbys', restaurant: 'Arby’s', start: '2026-10-20', end: '2026-10-31' }),
        deal({ id: 'tb', restaurant: 'Taco Bell', days: [2], startTime: '13:00' }),
        deal({ id: 'wed', restaurant: 'Arby’s', days: [3] }),
        deal({ id: 'over', restaurant: 'Arby’s', end: '2026-10-10' }),
        deal({ id: 'later', restaurant: 'Arby’s', start: '2026-10-29', end: '2026-10-29' }),
      ],
      '2026-10-27',
    );
    assert.deepEqual(list.map((d) => d.id), ['tb', 'arbys', 'whata']);
  });
});
