import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addDays,
  atTime,
  daysInMonth,
  diffDays,
  firstOfMonth,
  hhmmFromMinutes,
  lastOfMonth,
  minutesOf,
  nextWeekday,
  pad2,
  parseYMD,
  shiftMonth,
  todayYMD,
  toYMD,
  weekday,
  ymdParts,
} from '../src/lib/dates';

// The phone lives in San Antonio; pin the zone so DST cases mean the same thing on a UTC CI runner.
process.env.TZ = 'America/Chicago';
const isChicago = new Date(2026, 9, 31, 12).getTimezoneOffset() === 300;

describe('pad2 / ymdParts / toYMD', () => {
  it('pads single digits only', () => {
    assert.equal(pad2(3), '03');
    assert.equal(pad2(12), '12');
  });

  it('splits a YMD into numbers', () => {
    assert.deepEqual(ymdParts('2026-10-24'), { y: 2026, m: 10, d: 24 });
  });

  it('formats a local Date as YYYY-MM-DD', () => {
    assert.equal(toYMD(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  });
});

describe('todayYMD', () => {
  it('uses the local calendar day, even late at night', () => {
    assert.equal(todayYMD(new Date(2026, 9, 24, 0, 0)), '2026-10-24');
    assert.equal(todayYMD(new Date(2026, 9, 24, 23, 59, 59)), '2026-10-24');
  });
});

describe('parseYMD', () => {
  it('returns local midnight', () => {
    const d = parseYMD('2026-11-01');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 10);
    assert.equal(d.getDate(), 1);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  });
});

describe('weekday', () => {
  it('knows 2026-10-24 is a Saturday', () => {
    assert.equal(weekday('2026-10-24'), 6);
  });

  it('numbers Sunday 0 through Saturday 6', () => {
    assert.equal(weekday('2026-10-25'), 0);
    assert.equal(weekday('2026-10-26'), 1);
    assert.equal(weekday('2026-10-27'), 2);
    assert.equal(weekday('2026-11-01'), 0);
    assert.equal(weekday('2027-01-01'), 5);
    assert.equal(weekday('2028-02-29'), 2);
  });
});

describe('addDays', () => {
  it('moves within a month', () => {
    assert.equal(addDays('2026-10-24', 0), '2026-10-24');
    assert.equal(addDays('2026-10-24', 3), '2026-10-27');
    assert.equal(addDays('2026-10-24', -4), '2026-10-20');
  });

  it('crosses month ends', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-11-01', -1), '2026-10-31');
    assert.equal(addDays('2026-04-30', 1), '2026-05-01');
  });

  it('crosses year ends', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  });

  it('handles February in common and leap years', () => {
    assert.equal(addDays('2026-02-28', 1), '2026-03-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  });

  it('is not thrown off by the Nov 1, 2026 fall-back DST change', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-11-01', 1), '2026-11-02');
    assert.equal(addDays('2026-10-31', 2), '2026-11-02');
    assert.equal(addDays('2026-11-02', -2), '2026-10-31');
    // A week of daily steps across the change lands on the right day.
    let day = '2026-10-29';
    for (let i = 0; i < 7; i++) day = addDays(day, 1);
    assert.equal(day, '2026-11-05');
  });

  it('is not thrown off by the spring-forward DST change', () => {
    assert.equal(addDays('2027-03-14', 1), '2027-03-15');
    assert.equal(addDays('2027-03-15', -1), '2027-03-14');
  });

  it('handles long jumps', () => {
    assert.equal(addDays('2026-10-24', 365), '2027-10-24');
    assert.equal(addDays('2028-01-01', 366), '2029-01-01');
  });
});

describe('diffDays', () => {
  it('is positive when b is later and negative when earlier', () => {
    assert.equal(diffDays('2026-10-24', '2026-10-31'), 7);
    assert.equal(diffDays('2026-10-31', '2026-10-24'), -7);
    assert.equal(diffDays('2026-10-24', '2026-10-24'), 0);
  });

  it('counts whole days across DST and year ends', () => {
    assert.equal(diffDays('2026-10-31', '2026-11-02'), 2);
    assert.equal(diffDays('2026-12-31', '2027-01-01'), 1);
    assert.equal(diffDays('2028-01-01', '2029-01-01'), 366);
    assert.equal(diffDays('2027-03-13', '2027-03-15'), 2);
  });

  it('is the inverse of addDays', () => {
    for (const n of [-40, -1, 0, 1, 8, 100]) {
      assert.equal(diffDays('2026-10-24', addDays('2026-10-24', n)), n);
    }
  });
});

describe('daysInMonth / firstOfMonth / lastOfMonth', () => {
  it('knows month lengths, including leap years', () => {
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2028, 2), 29);
    assert.equal(daysInMonth(2100, 2), 28);
    assert.equal(daysInMonth(2000, 2), 29);
    assert.equal(daysInMonth(2026, 4), 30);
    assert.equal(daysInMonth(2026, 12), 31);
  });

  it('builds the first day of a month', () => {
    assert.equal(firstOfMonth(2026, 3), '2026-03-01');
    assert.equal(firstOfMonth(2026, 11), '2026-11-01');
  });

  it('builds the last day of a month', () => {
    assert.equal(lastOfMonth(2026, 10), '2026-10-31');
    assert.equal(lastOfMonth(2026, 11), '2026-11-30');
    assert.equal(lastOfMonth(2026, 12), '2026-12-31');
    assert.equal(lastOfMonth(2026, 2), '2026-02-28');
    assert.equal(lastOfMonth(2028, 2), '2028-02-29');
  });
});

describe('shiftMonth', () => {
  it('moves forward and back within a year', () => {
    assert.deepEqual(shiftMonth(2026, 10, 0), { year: 2026, month: 10 });
    assert.deepEqual(shiftMonth(2026, 10, 1), { year: 2026, month: 11 });
    assert.deepEqual(shiftMonth(2026, 10, -9), { year: 2026, month: 1 });
  });

  it('crosses year boundaries in both directions', () => {
    assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth(2027, 1, -1), { year: 2026, month: 12 });
    assert.deepEqual(shiftMonth(2026, 10, 15), { year: 2028, month: 1 });
    assert.deepEqual(shiftMonth(2026, 10, -22), { year: 2024, month: 12 });
    assert.deepEqual(shiftMonth(2026, 10, 24), { year: 2028, month: 10 });
  });
});

describe('atTime', () => {
  it('returns the local wall-clock time on that day', () => {
    const d = atTime('2026-10-24', '13:45');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 9);
    assert.equal(d.getDate(), 24);
    assert.equal(d.getHours(), 13);
    assert.equal(d.getMinutes(), 45);
    assert.equal(d.getSeconds(), 0);
    assert.equal(d.getMilliseconds(), 0);
  });

  it('defaults to midnight', () => {
    assert.equal(atTime('2026-10-24').getTime(), parseYMD('2026-10-24').getTime());
  });

  it('keeps the wall-clock time on and after the DST change', () => {
    for (const day of ['2026-10-31', '2026-11-01', '2026-11-02']) {
      const d = atTime(day, '09:00');
      assert.equal(toYMD(d), day);
      assert.equal(d.getHours(), 9);
      assert.equal(d.getMinutes(), 0);
    }
  });

  it('spans 25 real hours over the fall-back night in San Antonio', { skip: !isChicago }, () => {
    const ms = atTime('2026-11-01', '09:00').getTime() - atTime('2026-10-31', '09:00').getTime();
    assert.equal(ms / 3_600_000, 25);
  });
});

describe('minutesOf / hhmmFromMinutes', () => {
  it('converts HH:MM to minutes after midnight', () => {
    assert.equal(minutesOf('00:00'), 0);
    assert.equal(minutesOf('13:45'), 825);
    assert.equal(minutesOf('23:59'), 1439);
  });

  it('converts back and clamps to the same day', () => {
    assert.equal(hhmmFromMinutes(825), '13:45');
    assert.equal(hhmmFromMinutes(5), '00:05');
    assert.equal(hhmmFromMinutes(-30), '00:00');
    assert.equal(hhmmFromMinutes(2000), '23:59');
  });
});

describe('nextWeekday', () => {
  it('returns the same day when it already matches', () => {
    assert.equal(nextWeekday('2026-10-24', 6), '2026-10-24');
  });

  it('finds the next matching day', () => {
    assert.equal(nextWeekday('2026-10-24', 0), '2026-10-25');
    assert.equal(nextWeekday('2026-10-24', 1), '2026-10-26');
    assert.equal(nextWeekday('2026-10-24', 5), '2026-10-30');
    assert.equal(nextWeekday('2026-10-25', 6), '2026-10-31');
  });

  it('crosses month and year ends', () => {
    assert.equal(nextWeekday('2026-10-29', 0), '2026-11-01');
    assert.equal(nextWeekday('2026-12-30', 5), '2027-01-01');
  });
});
