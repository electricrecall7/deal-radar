import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { benefitDaysLeft, isBenefitUsed, periodBounds, upcomingPeriods } from '../src/lib/benefits';
import type { Benefit, Period } from '../src/lib/schema';

function benefit(over: Partial<Benefit> = {}): Benefit {
  return {
    id: 'gold-dining',
    card: 'amex-gold',
    title: '$10 dining credit',
    period: 'monthly',
    details: 'Up to $10 back each month.',
    status: 'confirmed',
    ...over,
  };
}

const period = (key: string, start: string, end: string) => ({ key, start, end });

describe('periodBounds', () => {
  it('monthly periods run from the 1st to the last day of the month', () => {
    assert.deepEqual(periodBounds('monthly', '2026-10-24'), period('2026-10', '2026-10-01', '2026-10-31'));
    assert.deepEqual(periodBounds('monthly', '2026-03-31'), period('2026-03', '2026-03-01', '2026-03-31'));
    assert.deepEqual(periodBounds('monthly', '2026-04-01'), period('2026-04', '2026-04-01', '2026-04-30'));
    assert.deepEqual(periodBounds('monthly', '2026-12-31'), period('2026-12', '2026-12-01', '2026-12-31'));
    assert.deepEqual(periodBounds('monthly', '2028-02-10'), period('2028-02', '2028-02-01', '2028-02-29'));
  });

  it('quarterly periods split at Mar 31 / Apr 1, Jun 30 / Jul 1 and end Dec 31', () => {
    assert.deepEqual(periodBounds('quarterly', '2026-01-01'), period('2026-Q1', '2026-01-01', '2026-03-31'));
    assert.deepEqual(periodBounds('quarterly', '2026-03-31'), period('2026-Q1', '2026-01-01', '2026-03-31'));
    assert.deepEqual(periodBounds('quarterly', '2026-04-01'), period('2026-Q2', '2026-04-01', '2026-06-30'));
    assert.deepEqual(periodBounds('quarterly', '2026-06-30'), period('2026-Q2', '2026-04-01', '2026-06-30'));
    assert.deepEqual(periodBounds('quarterly', '2026-07-01'), period('2026-Q3', '2026-07-01', '2026-09-30'));
    assert.deepEqual(periodBounds('quarterly', '2026-10-24'), period('2026-Q4', '2026-10-01', '2026-12-31'));
    assert.deepEqual(periodBounds('quarterly', '2026-12-31'), period('2026-Q4', '2026-10-01', '2026-12-31'));
  });

  it('semiannual periods split at Jun 30 / Jul 1', () => {
    assert.deepEqual(periodBounds('semiannual', '2026-01-01'), period('2026-H1', '2026-01-01', '2026-06-30'));
    assert.deepEqual(periodBounds('semiannual', '2026-06-30'), period('2026-H1', '2026-01-01', '2026-06-30'));
    assert.deepEqual(periodBounds('semiannual', '2026-07-01'), period('2026-H2', '2026-07-01', '2026-12-31'));
    assert.deepEqual(periodBounds('semiannual', '2026-12-31'), period('2026-H2', '2026-07-01', '2026-12-31'));
  });

  it('annual periods are calendar years', () => {
    assert.deepEqual(periodBounds('annual', '2026-01-01'), period('2026', '2026-01-01', '2026-12-31'));
    assert.deepEqual(periodBounds('annual', '2026-12-31'), period('2026', '2026-01-01', '2026-12-31'));
    assert.deepEqual(periodBounds('annual', '2027-01-01'), period('2027', '2027-01-01', '2027-12-31'));
  });

  it('returns null for perks that never reset', () => {
    assert.equal(periodBounds('none', '2026-10-24'), null);
  });
});

describe('upcomingPeriods', () => {
  const keys = (period: Period, today: string, horizon: number) =>
    upcomingPeriods(period, today, horizon).map((p) => p.key);

  it('is empty when even the current period ends after the horizon', () => {
    assert.deepEqual(keys('monthly', '2026-10-24', 0), []);
    assert.deepEqual(keys('monthly', '2026-10-24', 6), []);
  });

  it('starts with the current period', () => {
    assert.deepEqual(keys('monthly', '2026-10-24', 7), ['2026-10']);
    assert.deepEqual(keys('monthly', '2026-10-24', 21), ['2026-10']);
  });

  it('includes later periods whose last day falls within the horizon', () => {
    // Nov 30 is 37 days after Oct 24.
    assert.deepEqual(keys('monthly', '2026-10-24', 36), ['2026-10']);
    assert.deepEqual(keys('monthly', '2026-10-24', 37), ['2026-10', '2026-11']);
    assert.deepEqual(keys('monthly', '2026-10-24', 70), ['2026-10', '2026-11', '2026-12']);
  });

  it('includes the current period on its last day', () => {
    assert.deepEqual(keys('monthly', '2026-10-31', 0), ['2026-10']);
  });

  it('rolls over into the next year', () => {
    assert.deepEqual(keys('monthly', '2026-12-20', 45), ['2026-12', '2027-01']);
    assert.deepEqual(keys('quarterly', '2026-12-20', 120), ['2026-Q4', '2027-Q1']);
    assert.deepEqual(keys('semiannual', '2026-12-20', 200), ['2026-H2', '2027-H1']);
    assert.deepEqual(keys('annual', '2026-12-20', 30), ['2026']);
  });

  it('returns nothing for perks that never reset', () => {
    assert.deepEqual(keys('none', '2026-10-24', 365), []);
  });

  it('returns full bounds, not just keys', () => {
    const [, november] = upcomingPeriods('monthly', '2026-10-24', 37);
    assert.deepEqual(november, period('2026-11', '2026-11-01', '2026-11-30'));
  });
});

describe('isBenefitUsed', () => {
  const gold = benefit();

  it('is true only when marked used for the current period', () => {
    assert.equal(isBenefitUsed(gold, { 'gold-dining': '2026-10' }, '2026-10-24'), true);
    assert.equal(isBenefitUsed(gold, { 'gold-dining': '2026-09' }, '2026-10-24'), false);
    assert.equal(isBenefitUsed(gold, {}, '2026-10-24'), false);
    assert.equal(isBenefitUsed(gold, { other: '2026-10' }, '2026-10-24'), false);
  });

  it('resets automatically when the next period begins', () => {
    const used = { 'gold-dining': '2026-10' };
    assert.equal(isBenefitUsed(gold, used, '2026-10-31'), true);
    assert.equal(isBenefitUsed(gold, used, '2026-11-01'), false);
  });

  it('uses the period key of the benefit\'s own period', () => {
    const quarterly = benefit({ id: 'q', period: 'quarterly' });
    assert.equal(isBenefitUsed(quarterly, { q: '2026-Q4' }, '2026-12-31'), true);
    assert.equal(isBenefitUsed(quarterly, { q: '2026-10' }, '2026-10-24'), false);
  });

  it('is never true for perks that never reset', () => {
    const perk = benefit({ period: 'none' });
    assert.equal(isBenefitUsed(perk, { 'gold-dining': '2026-10' }, '2026-10-24'), false);
  });
});

describe('benefitDaysLeft', () => {
  it('counts days to the end of the current period', () => {
    assert.equal(benefitDaysLeft(benefit(), '2026-10-24'), 7);
    assert.equal(benefitDaysLeft(benefit(), '2026-10-31'), 0);
    assert.equal(benefitDaysLeft(benefit({ period: 'annual' }), '2026-12-30'), 1);
  });

  it('is undefined for perks that never reset', () => {
    assert.equal(benefitDaysLeft(benefit({ period: 'none' }), '2026-10-24'), undefined);
  });
});
