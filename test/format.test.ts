import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  daysLeftLabel,
  describeWhen,
  formatDay,
  formatDays,
  formatLongDay,
  formatShortDate,
  formatTime,
  formatTimeRange,
  money,
  periodLabel,
  relativeDay,
} from '../src/lib/format';
import type { Deal } from '../src/lib/schema';

const TODAY = '2026-10-24'; // Saturday

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

describe('formatTime', () => {
  it('drops :00 and uses 12-hour time', () => {
    assert.equal(formatTime('13:00'), '1 PM');
    assert.equal(formatTime('09:00'), '9 AM');
  });

  it('keeps minutes when present', () => {
    assert.equal(formatTime('16:30'), '4:30 PM');
    assert.equal(formatTime('07:05'), '7:05 AM');
  });

  it('handles midnight and noon', () => {
    assert.equal(formatTime('00:15'), '12:15 AM');
    assert.equal(formatTime('00:00'), '12 AM');
    assert.equal(formatTime('12:00'), '12 PM');
    assert.equal(formatTime('11:59'), '11:59 AM');
    assert.equal(formatTime('23:59'), '11:59 PM');
  });
});

describe('formatTimeRange', () => {
  it('formats start and end', () => {
    assert.equal(formatTimeRange('16:00', '18:00'), '4 PM–6 PM');
  });

  it('formats an open-ended start or end', () => {
    assert.equal(formatTimeRange('13:00'), 'from 1 PM');
    assert.equal(formatTimeRange(undefined, '10:30'), 'until 10:30 AM');
  });

  it('is empty with no times', () => {
    assert.equal(formatTimeRange(), '');
  });
});

describe('dates', () => {
  it('formats short, day and long-day labels', () => {
    assert.equal(formatShortDate('2026-10-24'), 'Oct 24');
    assert.equal(formatShortDate('2027-01-05'), 'Jan 5');
    assert.equal(formatDay('2026-10-24'), 'Sat, Oct 24');
    assert.equal(formatLongDay('2026-10-24'), 'Saturday, October 24');
    assert.equal(formatLongDay('2026-11-01'), 'Sunday, November 1');
  });
});

describe('relativeDay', () => {
  it('names today, tomorrow and yesterday', () => {
    assert.equal(relativeDay('2026-10-24', TODAY), 'Today');
    assert.equal(relativeDay('2026-10-25', TODAY), 'Tomorrow');
    assert.equal(relativeDay('2026-10-23', TODAY), 'Yesterday');
  });

  it('uses the weekday for the rest of the coming week', () => {
    assert.equal(relativeDay('2026-10-26', TODAY), 'Mon');
    assert.equal(relativeDay('2026-10-27', TODAY), 'Tue');
    assert.equal(relativeDay('2026-10-30', TODAY), 'Fri');
  });

  it('uses the date a week or more out, and in the past', () => {
    assert.equal(relativeDay('2026-10-31', TODAY), 'Oct 31');
    assert.equal(relativeDay('2026-12-25', TODAY), 'Dec 25');
    assert.equal(relativeDay('2026-10-20', TODAY), 'Oct 20');
  });
});

describe('formatDays', () => {
  it('names a single day', () => {
    assert.equal(formatDays([2]), 'Tue');
  });

  it('joins two days with &', () => {
    assert.equal(formatDays([1, 5]), 'Mon & Fri');
    assert.equal(formatDays([5, 1]), 'Mon & Fri');
  });

  it('lists three or more days with commas', () => {
    assert.equal(formatDays([1, 3, 5]), 'Mon, Wed & Fri');
  });

  it('names weekdays, weekends and every day', () => {
    assert.equal(formatDays([1, 2, 3, 4, 5]), 'weekday');
    assert.equal(formatDays([5, 4, 3, 2, 1]), 'weekday');
    assert.equal(formatDays([0, 6]), 'weekend day');
    assert.equal(formatDays([6, 0]), 'weekend day');
    assert.equal(formatDays([0, 1, 2, 3, 4, 5, 6]), 'day');
  });

  it('ignores duplicates', () => {
    assert.equal(formatDays([2, 2]), 'Tue');
  });
});

describe('describeWhen', () => {
  it('describes weekly deals with their time and end', () => {
    const tue = deal({ days: [2], startTime: '13:00', start: '2026-10-20', end: '2026-11-02' });
    assert.equal(describeWhen(tue, TODAY), 'Every Tue · from 1 PM · thru Nov 2');
    assert.equal(describeWhen(deal({ days: [1, 5] }), TODAY), 'Every Mon & Fri');
    const breakfast = deal({ days: [1, 2, 3, 4, 5], endTime: '10:30' });
    assert.equal(describeWhen(breakfast, TODAY), 'Every weekday · until 10:30 AM');
  });

  it('mentions a weekly deal that has not started yet', () => {
    assert.equal(describeWhen(deal({ days: [2], start: '2026-11-03' }), TODAY), 'Every Tue · starts Nov 3');
  });

  it('describes one-day deals relative to today', () => {
    const today = deal({ start: TODAY, end: TODAY, startTime: '16:00', endTime: '18:00' });
    assert.equal(describeWhen(today, TODAY), 'Today only · 4 PM–6 PM');
    assert.equal(describeWhen(deal({ start: '2026-10-25', end: '2026-10-25' }), TODAY), 'Tomorrow only');
    assert.equal(describeWhen(deal({ start: '2026-10-29', end: '2026-10-29' }), TODAY), 'Thu only');
    assert.equal(describeWhen(deal({ start: '2026-11-11', end: '2026-11-11' }), TODAY), 'Nov 11 only');
  });

  it('describes running promos by when they end', () => {
    assert.equal(describeWhen(deal({ start: '2026-10-20', end: TODAY }), TODAY), 'Ends today');
    assert.equal(describeWhen(deal({ start: '2026-10-20', end: '2026-10-25' }), TODAY), 'Ends tomorrow');
    assert.equal(describeWhen(deal({ start: '2026-10-20', end: '2026-10-31' }), TODAY), 'Through Oct 31');
    assert.equal(
      describeWhen(deal({ start: '2026-10-20', end: '2026-10-31', endTime: '22:00' }), TODAY),
      'Through Oct 31 · until 10 PM',
    );
  });

  it('describes future promos as a date range', () => {
    assert.equal(describeWhen(deal({ start: '2026-10-26', end: '2026-10-31' }), TODAY), 'Oct 26 – Oct 31');
    assert.equal(
      describeWhen(deal({ start: '2026-12-26', end: '2027-01-02', startTime: '11:00' }), TODAY),
      'Dec 26 – Jan 2 · from 11 AM',
    );
  });

  it('describes ongoing deals', () => {
    assert.equal(describeWhen(deal(), TODAY), 'Ongoing');
    assert.equal(describeWhen(deal({ start: '2026-11-01' }), TODAY), 'Starts Nov 1');
  });
});

describe('money / periodLabel / daysLeftLabel', () => {
  it('shows whole dollars without cents and others with two decimals', () => {
    assert.equal(money(10), '$10');
    assert.equal(money(7.5), '$7.50');
    assert.equal(money(0), '$0');
  });

  it('labels reset periods', () => {
    assert.equal(periodLabel('monthly'), 'every month');
    assert.equal(periodLabel('quarterly'), 'every quarter');
    assert.equal(periodLabel('semiannual'), 'every half-year');
    assert.equal(periodLabel('annual'), 'every year');
    assert.equal(periodLabel('none'), '');
  });

  it('labels days left before a reset', () => {
    assert.equal(daysLeftLabel(0), 'resets tonight');
    assert.equal(daysLeftLabel(1), 'resets tomorrow night');
    assert.equal(daysLeftLabel(5), 'resets in 5 days');
  });
});
