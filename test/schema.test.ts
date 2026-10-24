import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { BenefitSchema, DealSchema, DealsFileSchema, parseDealsFile } from '../src/lib/schema';

const goodDeal = {
  id: 'tb-tue',
  restaurant: 'Taco Bell',
  title: '$1 celebrity meal drop',
  category: 'app',
  channel: 'app',
  start: '2026-10-20',
  end: '2026-11-02',
  days: [2],
  startTime: '13:00',
  status: 'unconfirmed',
};

const goodBenefit = {
  id: 'gold-dining',
  card: 'amex-gold',
  title: '$10 dining credit',
  amount: 10,
  period: 'monthly',
  details: 'Up to $10 back each month.',
  status: 'confirmed',
};

function file(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    updatedAt: '2026-10-24T08:00:00.000Z',
    region: 'San Antonio, TX',
    deals: [goodDeal],
    benefits: [goodBenefit],
    cards: [],
    resources: [],
    ...over,
  };
}

describe('DealSchema', () => {
  it('accepts a complete deal', () => {
    assert.equal(DealSchema.safeParse(goodDeal).success, true);
  });

  it('rejects malformed dates, times, weekdays and categories', () => {
    const bad = (over: Record<string, unknown>) => DealSchema.safeParse({ ...goodDeal, ...over }).success;
    assert.equal(bad({ start: '2026-10-2' }), false);
    assert.equal(bad({ end: '10/31/2026' }), false);
    assert.equal(bad({ startTime: '9:00' }), false);
    assert.equal(bad({ startTime: '24:00' }), false);
    assert.equal(bad({ days: [7] }), false);
    assert.equal(bad({ category: 'coupon' }), false);
    assert.equal(bad({ status: 'maybe' }), false);
    assert.equal(bad({ restaurant: '' }), false);
  });

  it('requires id, restaurant, title, category, start and status', () => {
    for (const key of ['id', 'restaurant', 'title', 'category', 'start', 'status']) {
      const copy: Record<string, unknown> = { ...goodDeal };
      delete copy[key];
      assert.equal(DealSchema.safeParse(copy).success, false, key);
    }
  });
});

describe('BenefitSchema', () => {
  it('accepts a credit and rejects an unknown card or period', () => {
    assert.equal(BenefitSchema.safeParse(goodBenefit).success, true);
    assert.equal(BenefitSchema.safeParse({ ...goodBenefit, card: 'chase-sapphire' }).success, false);
    assert.equal(BenefitSchema.safeParse({ ...goodBenefit, period: 'weekly' }).success, false);
  });
});

describe('parseDealsFile', () => {
  it('keeps a valid file whole', () => {
    const { file: parsed, dropped } = parseDealsFile(file());
    assert.equal(dropped, 0);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.deals.length, 1);
    assert.equal(parsed.benefits.length, 1);
    assert.deepEqual(parsed.deals[0].days, [2]);
  });

  it('drops one invalid deal but keeps the rest', () => {
    const deals = [
      goodDeal,
      { ...goodDeal, id: 'broken', start: 'next tuesday' },
      { ...goodDeal, id: 'wendys', restaurant: 'Wendy’s', days: [1, 5] },
    ];
    const { file: parsed, dropped } = parseDealsFile(file({ deals }));
    assert.equal(dropped, 1);
    assert.deepEqual(parsed.deals.map((d) => d.id), ['tb-tue', 'wendys']);
  });

  it('counts drops across every list', () => {
    const { file: parsed, dropped } = parseDealsFile(
      file({
        deals: [goodDeal, { id: 'no-restaurant' }],
        benefits: [goodBenefit, { ...goodBenefit, id: 'x', period: 'weekly' }],
        cards: [{ id: 'gold', card: 'amex-gold', name: 'Amex Gold' }],
        resources: [
          { name: 'r/fastfood', kind: 'reddit', why: 'Deal threads' },
          { name: 'Bad', kind: 'tv', why: '' },
        ],
      }),
    );
    // The card is missing its required earn list.
    assert.equal(dropped, 4);
    assert.equal(parsed.deals.length, 1);
    assert.equal(parsed.benefits.length, 1);
    assert.equal(parsed.cards.length, 0);
    assert.equal(parsed.resources.length, 1);
  });

  it('fills a missing region and missing lists', () => {
    const { file: parsed, dropped } = parseDealsFile({ version: 1, updatedAt: '2026-10-24T08:00:00.000Z' });
    assert.equal(dropped, 0);
    assert.equal(parsed.region, 'San Antonio, TX');
    assert.deepEqual(parsed.deals, []);
    assert.deepEqual(parsed.benefits, []);
    assert.deepEqual(parsed.cards, []);
    assert.deepEqual(parsed.resources, []);
  });

  it('rejects a file whose version is not 1', () => {
    assert.throws(() => parseDealsFile(file({ version: 2 })));
    assert.throws(() => parseDealsFile(file({ version: '1' })));
    const noVersion: Record<string, unknown> = file();
    delete noVersion.version;
    assert.throws(() => parseDealsFile(noVersion));
  });

  it('rejects things that are not a deals file at all', () => {
    assert.throws(() => parseDealsFile(null));
    assert.throws(() => parseDealsFile('<html>404</html>'));
    assert.throws(() => parseDealsFile(file({ deals: 'none' })));
    assert.throws(() => parseDealsFile(file({ updatedAt: undefined })));
  });
});

describe('data/deals.json', () => {
  const json: unknown = JSON.parse(readFileSync(new URL('../data/deals.json', import.meta.url), 'utf8'));

  it('parses without dropping anything', () => {
    const { file: parsed, dropped } = parseDealsFile(json);
    assert.equal(dropped, 0);
    assert.ok(parsed.deals.length > 0);
  });

  it('passes the strict schema too', () => {
    assert.equal(DealsFileSchema.safeParse(json).success, true);
  });

  it('has unique ids and sane date ranges', () => {
    const { file: parsed } = parseDealsFile(json);
    const dealIds = parsed.deals.map((d) => d.id);
    assert.equal(new Set(dealIds).size, dealIds.length, 'duplicate deal id');
    const benefitIds = parsed.benefits.map((b) => b.id);
    assert.equal(new Set(benefitIds).size, benefitIds.length, 'duplicate benefit id');
    for (const d of parsed.deals) {
      if (d.end) assert.ok(d.end >= d.start, `${d.id} ends before it starts`);
    }
  });
});
