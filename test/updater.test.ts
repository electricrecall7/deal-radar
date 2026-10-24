import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addPartialUsage, addUsage, createLimiter, emptyUsage } from '../scripts/updater/claude';
import { parseArgs } from '../scripts/updater/config';
import {
  dealForPrompt,
  invalidEntries,
  normalizeDate,
  normalizeDays,
  normalizeTime,
  toDeal,
} from '../scripts/updater/convert';
import {
  applyBenefitReviews,
  applyCardReviews,
  applyVerdicts,
  assignIds,
  brandKey,
  buildFile,
  chicagoToday,
  dedupeCandidates,
  dedupeExisting,
  dedupeKey,
  isDuplicate,
  jaccard,
  pickForVerify,
  pruneEnded,
  serializeFile,
  slugify,
  sortDeals,
  titleTokens,
} from '../scripts/updater/merge';
import { ANGLES, SYSTEM_PROMPT, discoverContent } from '../scripts/updater/prompts';
import {
  SUBMIT_TOOLS,
  SubmitDealsZ,
  type BenefitReview,
  type ToolBenefit,
  type ToolDeal,
  type Verdict,
} from '../scripts/updater/tools';
import {
  DealsFileSchema,
  parseDealsFile,
  type Benefit,
  type CardInfo,
  type Deal,
  type DealsFile,
} from '../src/lib/schema';

const TODAY = '2026-10-24';

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: 'shake-shack-scarygood',
    restaurant: 'Shake Shack',
    title: 'Free Single ShackBurger w/ $10+ order',
    category: 'deal',
    start: '2026-10-20',
    end: '2026-10-31',
    status: 'unconfirmed',
    firstSeen: '2026-10-10',
    ...over,
  };
}

function toolDeal(over: Partial<ToolDeal> = {}): ToolDeal {
  return {
    restaurant: 'Shake Shack',
    title: 'Free Single ShackBurger w/ $10+ order',
    details: '',
    category: 'deal',
    channel: '',
    code: '',
    card: '',
    local: false,
    location: '',
    start: '2026-10-20',
    end: '2026-10-31',
    days: [],
    startTime: '',
    endTime: '',
    tags: [],
    status: 'unconfirmed',
    sourceUrl: '',
    sourceName: '',
    notes: '',
    ...over,
  };
}

function verdict(over: Partial<Verdict> & { id: string }): Verdict {
  return {
    action: 'keep',
    confirmed: false,
    removeReason: '',
    reason: 'checked',
    evidenceUrl: '',
    corrected: null,
    ...over,
  };
}

function benefit(over: Partial<Benefit> = {}): Benefit {
  return {
    id: 'amex-gold-dining-credit',
    card: 'amex-gold',
    title: '$10 dining credit',
    amount: 10,
    period: 'monthly',
    details: 'Up to $10 back each month.',
    status: 'unconfirmed',
    ...over,
  };
}

function toolBenefit(over: Partial<ToolBenefit> = {}): ToolBenefit {
  return {
    card: 'amex-gold',
    cardName: '',
    title: '$10 dining credit',
    amount: 10,
    period: 'monthly',
    merchants: [],
    enrollment: false,
    details: 'Up to $10 back each month.',
    howToUse: '',
    sourceUrl: '',
    notes: '',
    ...over,
  };
}

function review(over: Partial<BenefitReview> = {}): BenefitReview {
  return {
    id: 'amex-gold-dining-credit',
    action: 'keep',
    confirmed: false,
    reason: 'ok',
    sourceUrl: '',
    benefit: null,
    ...over,
  };
}

const SOURCE = 'https://www.americanexpress.com/us/credit-cards/card/gold-card/';

describe('chicagoToday', () => {
  it('uses San Antonio time, not UTC', () => {
    // 03:00 UTC on Oct 25 is 22:00 CDT on Oct 24.
    assert.equal(chicagoToday(new Date('2026-10-25T03:00:00Z')), '2026-10-24');
    assert.equal(chicagoToday(new Date('2026-10-25T06:00:00Z')), '2026-10-25');
    // 05:30 UTC in January is 23:30 CST the day before.
    assert.equal(chicagoToday(new Date('2027-01-05T05:30:00Z')), '2027-01-04');
  });
});

describe('parseArgs', () => {
  it('reads flags and env overrides', () => {
    const argv = ['--dry-run', '--skip-benefits', '--angles=card-offers,loyalty-perks', '--limit=40'];
    const opts = parseArgs(argv, { DEAL_MODEL: 'claude-sonnet-5-5', DEAL_EFFORT: 'medium' });
    assert.equal(opts.dryRun, true);
    assert.equal(opts.skipBenefits, true);
    assert.equal(opts.skipVerify, false);
    assert.deepEqual(opts.angles, ['card-offers', 'loyalty-perks']);
    assert.equal(opts.limit, 40);
    assert.equal(opts.model, 'claude-sonnet-5-5');
    assert.equal(opts.effort, 'medium');
  });

  it('defaults to Opus 5.5 at high effort', () => {
    const opts = parseArgs([]);
    assert.equal(opts.model, 'claude-opus-5-5');
    assert.equal(opts.effort, 'high');
    assert.equal(opts.limit, undefined);
  });

  it('rejects unknown flags and bad numbers', () => {
    assert.throws(() => parseArgs(['--fast']));
    assert.throws(() => parseArgs(['--limit=0']));
    assert.throws(() => parseArgs(['--limit=abc']));
    assert.throws(() => parseArgs([], { DEAL_EFFORT: 'extreme' }));
  });
});

describe('normalize helpers', () => {
  it('pads and validates dates', () => {
    assert.equal(normalizeDate('2026-11-3'), '2026-11-03');
    assert.equal(normalizeDate('2026-02-30'), undefined);
    assert.equal(normalizeDate('Nov 3'), undefined);
  });

  it('turns 12-hour times into HH:MM', () => {
    assert.equal(normalizeTime('13:00'), '13:00');
    assert.equal(normalizeTime('1:00 PM'), '13:00');
    assert.equal(normalizeTime('1pm'), '13:00');
    assert.equal(normalizeTime('12 AM'), '00:00');
    assert.equal(normalizeTime('12:30 p.m.'), '12:30');
    assert.equal(normalizeTime('9:05'), '09:05');
    assert.equal(normalizeTime('24:00'), '23:59');
    assert.equal(normalizeTime('13'), undefined);
    assert.equal(normalizeTime('noon'), undefined);
  });

  it('drops weekday lists that mean every day', () => {
    assert.deepEqual(normalizeDays([4, 2, 2]), [2, 4]);
    assert.equal(normalizeDays([0, 1, 2, 3, 4, 5, 6]), undefined);
    assert.equal(normalizeDays([]), undefined);
  });
});

describe('toDeal', () => {
  it('strips empty fields and normalizes values', () => {
    const input = toolDeal({
      code: ' SCARYGOOD ',
      startTime: '1 PM',
      tags: ['Signup', 'signup', ' '],
      sourceUrl: 'not a url',
    });
    const r = toDeal(input, { id: 'x' });
    assert.ok(r.ok);
    assert.equal(r.value.code, 'SCARYGOOD');
    assert.equal(r.value.startTime, '13:00');
    assert.deepEqual(r.value.tags, ['signup']);
    assert.equal(r.value.channel, undefined);
    assert.equal(r.value.card, undefined);
    assert.equal(r.value.local, undefined);
    assert.equal(r.value.details, undefined);
    assert.equal(r.value.sourceUrl, undefined);
  });

  it('treats an empty end as ongoing and rejects broken dates', () => {
    const ongoing = toDeal(toolDeal({ end: '' }), { id: 'x' });
    assert.ok(ongoing.ok);
    assert.equal(ongoing.value.end, undefined);
    assert.equal(toDeal(toolDeal({ start: 'next week' }), { id: 'x' }).ok, false);
    assert.equal(toDeal(toolDeal({ end: '2026-10-01' }), { id: 'x' }).ok, false);
    assert.equal(toDeal(toolDeal({ restaurant: ' ' }), { id: 'x' }).ok, false);
  });

  it('keeps targeted card offers unconfirmed', () => {
    const input = toolDeal({ category: 'card', card: 'amex-gold', tags: ['targeted'], status: 'confirmed' });
    const r = toDeal(input, { id: 'x' });
    assert.ok(r.ok);
    assert.equal(r.value.status, 'unconfirmed');
    assert.match(r.value.notes ?? '', /Targeted: check your account/);
  });

  it('keeps bookkeeping out of prompts', () => {
    const shown = dealForPrompt(deal({ verifiedAt: '2026-10-17', checkedAt: '2026-10-23', custom: true }));
    assert.equal(shown.verifiedAt, '2026-10-17');
    for (const key of ['firstSeen', 'checkedAt', 'custom']) assert.equal(key in shown, false, key);
  });
});

describe('invalidEntries', () => {
  it('names each entry the lenient parse would drop, with its first problem', () => {
    const raw = {
      version: 1,
      updatedAt: '2026-10-17T10:00:00.000Z',
      deals: [deal(), { ...deal({ id: 'bad-date' }), start: '10/20/2026' }, { title: 'no id' }],
      benefits: [benefit()],
      cards: [],
      resources: [{ name: 'r/sanantonio', kind: 'forum', why: 'Local tips' }],
    };
    const lines = invalidEntries(raw);
    assert.equal(lines.length, 3);
    assert.equal(lines[0], 'deals[1] (bad-date): start: expected YYYY-MM-DD');
    assert.match(lines[1], /^deals\[2\]: id: /);
    assert.match(lines[2], /^resources\[0\] \(r\/sanantonio\): kind: /);
    assert.equal(parseDealsFile(raw).dropped, lines.length);
    assert.deepEqual(invalidEntries({ ...raw, deals: [deal()], resources: [] }), []);
  });
});

describe('pruneEnded', () => {
  it('removes deals that ended before today and keeps the rest', () => {
    const { kept, removed } = pruneEnded(
      [
        deal({ id: 'ended', end: '2026-10-23' }),
        deal({ id: 'last-day', end: TODAY }),
        deal({ id: 'ongoing', end: undefined }),
      ],
      TODAY,
    );
    assert.deepEqual(
      kept.map((d) => d.id),
      ['last-day', 'ongoing'],
    );
    assert.deepEqual(
      removed.map((c) => [c.id, c.reason]),
      [['ended', 'ended']],
    );
  });
});

describe('pickForVerify', () => {
  const deals = [
    deal({ id: 'last-week', verifiedAt: '2026-10-17' }),
    deal({ id: 'never' }),
    deal({ id: 'custom', custom: true }),
    deal({ id: 'older', verifiedAt: '2026-10-01' }),
    deal({ id: 'yesterday', verifiedAt: '2026-10-23' }),
  ];

  it('puts the least recently verified first and skips custom and freshly verified deals', () => {
    const { due, fresh } = pickForVerify(deals, TODAY);
    assert.deepEqual(
      due.map((d) => d.id),
      ['never', 'older', 'last-week'],
    );
    assert.equal(fresh, 1);
  });

  it('honors the limit', () => {
    assert.deepEqual(
      pickForVerify(deals, TODAY, 2).due.map((d) => d.id),
      ['never', 'older'],
    );
  });

  it('goes by the last check, so deals that never confirm move to the back after a check', () => {
    const queue = [
      // Last confirmed long ago, but looked at last week: behind deals that weren't.
      deal({ id: 'stuck', verifiedAt: '2026-09-01', checkedAt: '2026-10-17' }),
      deal({ id: 'confirmed', verifiedAt: '2026-10-10', checkedAt: '2026-10-10' }),
      deal({ id: 'legacy', verifiedAt: '2026-10-12' }),
      deal({ id: 'checked-yesterday', verifiedAt: '2026-08-01', checkedAt: '2026-10-23' }),
    ];
    const { due, fresh } = pickForVerify(queue, TODAY);
    assert.deepEqual(
      due.map((d) => d.id),
      ['confirmed', 'legacy', 'stuck'],
    );
    assert.equal(fresh, 1);
  });
});

describe('applyVerdicts', () => {
  it('re-confirms a kept deal and refreshes verifiedAt', () => {
    const r = applyVerdicts([deal()], [verdict({ id: 'shake-shack-scarygood', confirmed: true })], TODAY);
    assert.equal(r.deals[0].status, 'confirmed');
    assert.equal(r.deals[0].verifiedAt, TODAY);
    assert.equal(r.confirmed, 1);
  });

  it('downgrades a deal it could not re-confirm and keeps the old verifiedAt', () => {
    const r = applyVerdicts(
      [deal({ status: 'confirmed', verifiedAt: '2026-10-17' })],
      [verdict({ id: 'shake-shack-scarygood', confirmed: false })],
      TODAY,
    );
    assert.equal(r.deals[0].status, 'unconfirmed');
    assert.equal(r.deals[0].verifiedAt, '2026-10-17');
    assert.equal(r.deals[0].checkedAt, TODAY);
    assert.deepEqual(r.updated[0].fields, ['status']);
  });

  it('stamps checkedAt on every keep and update, without counting it as a change', () => {
    const before = [
      deal({ id: 'a', status: 'confirmed', verifiedAt: '2026-10-17', checkedAt: '2026-10-17' }),
      deal({ id: 'b', checkedAt: '2026-10-10' }),
      deal({ id: 'c', checkedAt: '2026-10-10' }),
      deal({ id: 'd', checkedAt: '2026-10-10' }),
    ];
    const r = applyVerdicts(
      before,
      [
        verdict({ id: 'a', confirmed: true }),
        verdict({ id: 'b' }),
        verdict({ id: 'c', action: 'update', corrected: toolDeal({ end: '2026-11-02' }) }),
      ],
      TODAY,
    );
    assert.deepEqual(
      r.deals.map((d) => [d.id, d.checkedAt]),
      [
        ['a', TODAY],
        ['b', TODAY],
        ['c', TODAY],
        // No verdict: not looked at, so its place in the queue stays.
        ['d', '2026-10-10'],
      ],
    );
    assert.equal(r.deals[0].verifiedAt, TODAY);
    assert.deepEqual(
      r.updated.map((c) => [c.id, c.fields]),
      [['c', ['end']]],
    );
  });

  it('applies a correction but keeps the id, firstSeen and source', () => {
    const before = deal({ sourceUrl: 'https://shakeshack.com/old' });
    const r = applyVerdicts(
      [before],
      [
        verdict({
          id: before.id,
          action: 'update',
          confirmed: true,
          corrected: toolDeal({ end: '2026-11-02', code: 'SCARYGOOD', channel: 'online' }),
        }),
      ],
      TODAY,
    );
    const after = r.deals[0];
    assert.equal(after.id, before.id);
    assert.equal(after.firstSeen, '2026-10-10');
    assert.equal(after.end, '2026-11-02');
    assert.equal(after.sourceUrl, 'https://shakeshack.com/old');
    assert.equal(after.verifiedAt, TODAY);
    assert.deepEqual(r.updated[0].fields, ['channel', 'code', 'end', 'status']);
  });

  it('removes deals with a reason, and treats a correction that already ended as expired', () => {
    const r = applyVerdicts(
      [deal({ id: 'a' }), deal({ id: 'b' })],
      [
        verdict({ id: 'a', action: 'remove', removeReason: 'not-in-san-antonio', reason: 'Dallas only' }),
        verdict({ id: 'b', action: 'update', corrected: toolDeal({ start: '2026-10-01', end: '2026-10-05' }) }),
      ],
      TODAY,
    );
    assert.equal(r.deals.length, 0);
    assert.deepEqual(
      r.removed.map((c) => [c.id, c.reason]),
      [
        ['a', 'not-in-san-antonio'],
        ['b', 'expired'],
      ],
    );
  });

  it('leaves deals without a verdict alone and ignores unknown ids', () => {
    const before = deal({ status: 'confirmed' });
    const r = applyVerdicts([before], [verdict({ id: 'someone-else', action: 'remove' })], TODAY);
    assert.deepEqual(r.deals, [before]);
    assert.deepEqual(r.missing, [before.id]);
    assert.equal(r.removed.length, 0);
  });

  it('keeps the deal when a correction is invalid', () => {
    const before = deal();
    const r = applyVerdicts(
      [before],
      [verdict({ id: before.id, action: 'update', corrected: toolDeal({ start: 'soon' }) })],
      TODAY,
    );
    assert.equal(r.deals[0].start, before.start);
    assert.equal(r.problems.length, 1);
  });
});

describe('duplicate detection', () => {
  it('normalizes restaurant names', () => {
    assert.equal(dedupeKey('McDonald’s'), dedupeKey(" mcdonald's "));
    assert.equal(dedupeKey('McDonalds'), dedupeKey("McDonald's"));
    assert.equal(dedupeKey('Chick-fil-A'), dedupeKey('Chick fil A'));
    assert.notEqual(dedupeKey('Taco Bell'), dedupeKey('Taco Cabana'));
  });

  it('compares title words without stopwords, the restaurant name or plurals', () => {
    assert.deepEqual([...titleTokens('Free Whataburger at Whataburger', 'Whataburger')].sort(), ['free']);
    // "Tacos" is the item here, not the brand, so it stays.
    assert.deepEqual([...titleTokens('Free Tacos at Taco Cabana', 'Taco Cabana')].sort(), ['free', 'taco']);
    assert.deepEqual([...titleTokens('Whataburger', 'Whataburger')], ['whataburger']);
    assert.equal(jaccard(titleTokens('$1 nuggets on Tuesdays'), titleTokens('$1 Nugget Tuesday')), 1);
    assert.equal(jaccard(new Set(), new Set()), 0);
  });

  it('flags the same deal from two sources', () => {
    const a = deal();
    const b = deal({
      id: 'new-1',
      restaurant: 'shake shack',
      title: 'Free ShackBurger with $10 order',
      start: '2026-10-24',
    });
    assert.ok(isDuplicate(a, b));
  });

  it('flags a matching promo code even when the titles differ', () => {
    const a = deal({ code: 'SCARYGOOD' });
    const b = deal({ id: 'new-1', title: 'Halloween burger promo', code: 'scarygood' });
    assert.ok(isDuplicate(a, b));
  });

  it('matches a shared promo code across ways of writing the brand', () => {
    assert.equal(brandKey('Little Caesars (via Grubhub)'), 'littlecaesars');
    assert.equal(brandKey('Pizza Hut / DoorDash'), 'pizzahut');
    assert.equal(brandKey('A&W'), dedupeKey('A&W'));
    const a = deal({ restaurant: 'Little Caesars', title: '$5 off $20 online', code: 'CAESAR5' });
    const viaGrubhub = { ...a, id: 'x', restaurant: 'Little Caesars (via Grubhub)', title: 'Grubhub promo' };
    assert.ok(isDuplicate(a, { ...viaGrubhub, code: 'caesar5' }));
    assert.ok(isDuplicate(viaGrubhub, a));
    assert.ok(isDuplicate(a, { ...viaGrubhub, restaurant: 'Little Caesars / Grubhub' }));
    // One name extending the other is the same brand.
    const sonic = deal({ restaurant: 'Sonic', title: 'Half-price shakes', code: 'SHAKE' });
    assert.ok(isDuplicate(sonic, { ...sonic, id: 'x', restaurant: 'Sonic Drive-In', title: 'App code' }));
  });

  it('still needs the same brand, overlapping dates and the same code for the looser match', () => {
    const a = deal({ restaurant: 'Taco Bell', title: '$5 off $20', code: 'SAVE5' });
    assert.equal(isDuplicate(a, { ...a, id: 'x', restaurant: 'Taco Cabana', title: 'Other' }), false);
    const later = { ...a, id: 'x', restaurant: 'Taco Bell (app)', start: '2026-11-01', end: '2026-11-05' };
    assert.equal(isDuplicate(a, later), false);
    const otherCode = { ...a, id: 'x', restaurant: 'Taco Bell (app)', title: 'Other', code: 'SAVE10' };
    assert.equal(isDuplicate(a, otherCode), false);
    // Without a code, restaurants still have to match exactly.
    const plain = deal({ restaurant: 'Little Caesars', title: 'Free crazy bread' });
    assert.equal(isDuplicate(plain, { ...plain, id: 'x', restaurant: 'Little Caesars (via Grubhub)' }), false);
  });

  it('does not flag different restaurants, dates or weekdays', () => {
    const a = deal({ restaurant: 'Taco Bell', title: '$1 tacos', end: undefined, days: [2] });
    assert.equal(isDuplicate(a, { ...a, id: 'x', restaurant: 'Taco Cabana' }), false);
    assert.equal(isDuplicate(a, { ...a, id: 'x', days: [4] }), false);
    assert.ok(isDuplicate(a, { ...a, id: 'x', days: [2, 4] }));
    const dated = deal({ end: '2026-10-31' });
    assert.equal(isDuplicate(dated, { ...dated, id: 'x', start: '2026-11-01', end: '2026-11-05' }), false);
    assert.equal(isDuplicate(dated, { ...dated, id: 'x', title: 'Free fries Friday' }), false);
  });

  it('drops candidates that match known deals or each other, keeping the better-sourced one', () => {
    const known = [deal()];
    const candidates = [
      deal({ id: 'new-1', title: 'Free ShackBurger with $10+ order' }),
      deal({ id: 'new-2', restaurant: 'Whataburger', title: 'Free Honey Butter Chicken Biscuit', end: TODAY }),
      deal({
        id: 'new-3',
        restaurant: 'Whataburger',
        title: 'Free honey butter chicken biscuits',
        end: TODAY,
        status: 'confirmed',
        sourceUrl: 'https://whataburger.com/news',
      }),
    ];
    const { unique, duplicates } = dedupeCandidates(candidates, known);
    assert.deepEqual(
      unique.map((d) => d.id),
      ['new-3'],
    );
    assert.deepEqual(duplicates.map((c) => c.id).sort(), ['new-1', 'new-2']);
  });
});

describe('dedupeExisting', () => {
  const code = (id: string, over: Partial<Deal> = {}) =>
    deal({ id, restaurant: 'Little Caesars', title: '$5 off $20', code: 'CAESAR5', ...over });

  it('removes the lower-quality copy and keeps the rest in order', () => {
    const deals = [
      deal({ id: 'other', restaurant: 'Whataburger', title: 'Free biscuit' }),
      code('unconfirmed', { details: 'Lots of detail about the offer.', sourceUrl: 'https://x.test/a' }),
      code('confirmed', { restaurant: 'Little Caesars (via Grubhub)', status: 'confirmed' }),
    ];
    const r = dedupeExisting(deals);
    assert.deepEqual(
      r.kept.map((d) => d.id),
      ['other', 'confirmed'],
    );
    assert.deepEqual(
      r.removed.map((c) => [c.id, c.reason, c.detail]),
      [['unconfirmed', 'duplicate', 'same as confirmed']],
    );
    assert.deepEqual(
      r.removedDeals.map((d) => d.id),
      ['unconfirmed'],
    );
  });

  it('then prefers more details, then the copy seen first', () => {
    const detailed = dedupeExisting([
      code('bare'),
      code('detailed', { details: '$20 minimum, online only.', channel: 'online' }),
    ]);
    assert.deepEqual(
      detailed.kept.map((d) => d.id),
      ['detailed'],
    );
    const older = dedupeExisting([
      code('newer', { firstSeen: '2026-10-17' }),
      code('older', { firstSeen: '2026-10-03' }),
    ]);
    assert.deepEqual(
      older.kept.map((d) => d.id),
      ['older'],
    );
  });

  it('leaves custom deals and non-duplicates alone', () => {
    const deals = [code('mine', { custom: true, status: 'confirmed' }), code('file'), deal({ id: 'solo' })];
    const r = dedupeExisting(deals);
    assert.deepEqual(r.kept, deals);
    assert.equal(r.removed.length, 0);
  });
});

describe('ids', () => {
  it('slugifies names with apostrophes, accents and ampersands', () => {
    assert.equal(slugify("Panchito's Jalapeño & Cheese"), 'panchitos-jalapeno-and-cheese');
    assert.equal(slugify('$1 celebrity meal!'), '1-celebrity-meal');
    assert.ok(slugify('word '.repeat(40)).length <= 60);
  });

  it('gives new deals slug + start ids, unique against existing ones, and stamps firstSeen', () => {
    const existing = [deal({ id: 'whataburger-free-biscuit-2026-10-24' })];
    const found = (id: string, restaurant: string, title: string, start: string) =>
      deal({ id, restaurant, title, start, firstSeen: undefined });
    const fresh = assignIds(
      [
        found('new-1', 'Whataburger', 'Free biscuit', TODAY),
        found('new-2', 'Whataburger', 'Free biscuit!', TODAY),
        found('new-3', 'Taco Bell', '$1 Crunchwrap', '2026-11-01'),
      ],
      existing,
      TODAY,
    );
    assert.deepEqual(
      fresh.map((d) => d.id),
      [
        'whataburger-free-biscuit-2026-10-24-2',
        'whataburger-free-biscuit-2026-10-24-3',
        'taco-bell-1-crunchwrap-2026-11-01',
      ],
    );
    assert.ok(fresh.every((d) => d.firstSeen === TODAY));
  });

  it('sorts by start, then restaurant', () => {
    const sorted = sortDeals([
      deal({ id: 'c', restaurant: 'Wendy’s', start: '2026-10-25' }),
      deal({ id: 'b', restaurant: 'Arby’s', start: '2026-10-25' }),
      deal({ id: 'a', restaurant: 'Zaxby’s', start: '2026-10-20' }),
    ]);
    assert.deepEqual(
      sorted.map((d) => d.id),
      ['a', 'b', 'c'],
    );
  });
});

describe('buildFile', () => {
  const base: DealsFile = {
    version: 1,
    updatedAt: '2026-10-17T10:00:00.000Z',
    region: 'San Antonio, TX',
    deals: [],
    benefits: [],
    cards: [],
    resources: [{ name: 'r/sanantonio', kind: 'reddit', why: 'Local tips' }],
  };

  it('writes a valid, sorted file and keeps resources', () => {
    const file = buildFile(
      base,
      { deals: [deal({ id: 'b', start: '2026-10-25' }), deal({ id: 'a' })], benefits: [benefit()], cards: [] },
      new Date('2026-10-26T10:05:00Z'),
    );
    assert.equal(file.updatedAt, '2026-10-26T10:05:00.000Z');
    assert.deepEqual(
      file.deals.map((d) => d.id),
      ['a', 'b'],
    );
    assert.equal(file.resources.length, 1);
    assert.ok(DealsFileSchema.safeParse(JSON.parse(serializeFile(file))).success);
    assert.ok(serializeFile(file).endsWith('}\n'));
  });

  it('refuses invalid deals and duplicate ids', () => {
    const build = (deals: Deal[]) => () => buildFile(base, { deals, benefits: [], cards: [] }, new Date());
    assert.throws(build([deal(), deal()]));
    assert.throws(build([deal({ start: '10/20/2026' })]));
  });
});

describe('applyBenefitReviews', () => {
  it('confirms a kept benefit', () => {
    const r = applyBenefitReviews([benefit()], [review({ confirmed: true, sourceUrl: SOURCE })], TODAY);
    assert.equal(r.items[0].status, 'confirmed');
    assert.equal(r.items[0].verifiedAt, TODAY);
    assert.equal(r.items[0].sourceUrl, SOURCE);
  });

  it('only applies updates and removals that cite a source', () => {
    const existing = [benefit(), benefit({ id: 'amex-gold-uber-cash', title: '$10 Uber Cash' })];
    const r = applyBenefitReviews(
      existing,
      [
        review({ action: 'update', benefit: toolBenefit({ amount: 12 }) }),
        review({ id: 'amex-gold-uber-cash', action: 'remove' }),
      ],
      TODAY,
    );
    assert.deepEqual(r.items, existing);
    assert.equal(r.ignored.length, 2);

    const sourced = applyBenefitReviews(
      existing,
      [review({ action: 'update', confirmed: true, sourceUrl: SOURCE, benefit: toolBenefit({ amount: 12 }) })],
      TODAY,
    );
    assert.equal(sourced.items[0].amount, 12);
    assert.equal(sourced.items[0].id, 'amex-gold-dining-credit');
    assert.equal(sourced.items[1], existing[1]);
  });

  it('never removes most of the list at once', () => {
    const existing = [benefit({ id: 'a' }), benefit({ id: 'b' }), benefit({ id: 'c' })];
    const r = applyBenefitReviews(
      existing,
      ['a', 'b'].map((id) => review({ id, action: 'remove', sourceUrl: SOURCE })),
      TODAY,
    );
    assert.equal(r.items.length, 3);
    const removeA = review({ id: 'a', action: 'remove', sourceUrl: SOURCE });
    const one = applyBenefitReviews(existing, [removeA], TODAY);
    assert.deepEqual(
      one.items.map((b) => b.id),
      ['b', 'c'],
    );
  });

  it('adds missing benefits with a source, skipping ones already listed', () => {
    const r = applyBenefitReviews(
      [benefit()],
      [
        review({
          id: '',
          action: 'add',
          sourceUrl: SOURCE,
          benefit: toolBenefit({
            card: 'amex-platinum',
            title: '$100 Resy credit',
            amount: 100,
            period: 'quarterly',
          }),
        }),
        // Already listed as "$10 dining credit".
        review({
          id: '',
          action: 'add',
          sourceUrl: SOURCE,
          benefit: toolBenefit({ title: '$10 monthly dining credit' }),
        }),
        review({ id: '', action: 'add', benefit: toolBenefit({ card: 'citi', title: 'No source credit' }) }),
      ],
      TODAY,
    );
    assert.deepEqual(
      r.items.map((b) => b.id),
      ['amex-gold-dining-credit', 'amex-platinum-100-resy-credit'],
    );
    assert.equal(r.ignored.length, 2);
  });
});

describe('applyCardReviews', () => {
  const gold: CardInfo = {
    id: 'amex-gold',
    card: 'amex-gold',
    name: 'American Express Gold Card',
    annualFee: 325,
    earn: [{ rate: '4X', category: 'Restaurants worldwide', cap: '$50,000/yr' }],
  };

  it('keeps ids stable on update and turns -1 fees into missing', () => {
    const r = applyCardReviews(
      [gold],
      [
        {
          id: 'amex-gold',
          action: 'update',
          reason: 'new earn',
          sourceUrl: SOURCE,
          info: {
            card: 'amex-gold',
            name: 'American Express Gold Card',
            annualFee: -1,
            earn: [{ rate: '4X', category: 'U.S. supermarkets', cap: '' }],
            notes: '',
            sourceUrl: '',
          },
        },
      ],
    );
    assert.equal(r.items[0].id, 'amex-gold');
    assert.equal(r.items[0].annualFee, undefined);
    assert.deepEqual(r.items[0].earn, [{ rate: '4X', category: 'U.S. supermarkets' }]);
    assert.equal(r.items[0].sourceUrl, SOURCE);
  });
});

describe('submit tool schemas', () => {
  type Schema = Record<string, unknown>;

  function walk(schema: Schema, visit: (s: Schema) => void) {
    visit(schema);
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const child of Object.values(props)) walk(child, visit);
    if (schema.items) walk(schema.items as Schema, visit);
    for (const option of (schema.anyOf ?? []) as Schema[]) walk(option, visit);
  }

  it('meet the strict-mode rules', () => {
    for (const tool of SUBMIT_TOOLS) {
      assert.equal(tool.strict, true, tool.name);
      let unions = 0;
      walk(tool.input_schema as Schema, (s) => {
        if (s.anyOf || Array.isArray(s.type)) unions++;
        for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern']) {
          assert.equal(s[banned], undefined, `${tool.name} uses ${banned}`);
        }
        if (s.type !== 'object') return;
        assert.equal(s.additionalProperties, false, tool.name);
        const required = [...(s.required as string[])].sort();
        assert.deepEqual(required, Object.keys(s.properties as object).sort(), tool.name);
      });
      // Strict schemas allow at most 16 union-typed parameters per request.
      assert.ok(unions <= 16, `${tool.name} has ${unions} unions`);
    }
  });

  it('match their zod mirrors', () => {
    const parsed = SubmitDealsZ.safeParse({ deals: [toolDeal()], notes: '' });
    assert.ok(parsed.success);
  });
});

describe('usage totals', () => {
  type Message = Parameters<typeof addPartialUsage>[1];
  const usage = (over: Partial<Message['usage']> = {}) =>
    ({
      input_tokens: 1000,
      output_tokens: 1,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 0,
      server_tool_use: null,
      ...over,
    }) as Message['usage'];
  const partial = (over: Partial<Message>) =>
    ({ stop_reason: null, usage: usage(), content: [], ...over }) as Message;
  const call = (name: string) => ({ type: 'server_tool_use', id: name, name, input: {} });

  it('counts the searches and fetches a stream made before it was cut off', () => {
    const totals = emptyUsage();
    const content = [
      call('web_search'),
      { type: 'text', text: 'Looking' },
      call('web_search'),
      call('web_fetch'),
    ];
    addPartialUsage(totals, partial({ content: content as Message['content'] }));
    assert.deepEqual(totals, {
      ...emptyUsage(),
      requests: 1,
      incompleteRequests: 1,
      inputTokens: 1000,
      outputTokens: 1,
      cacheReadTokens: 200,
      webSearches: 2,
      webFetches: 1,
    });
  });

  it('uses the reported counts once they are final', () => {
    const totals = emptyUsage();
    addUsage(totals, usage({ server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 } }));
    const tools = { web_search_requests: 1, web_fetch_requests: 2 };
    const final = usage({ output_tokens: 500, server_tool_use: tools });
    addPartialUsage(totals, partial({ stop_reason: 'end_turn', usage: final }));
    assert.equal(totals.requests, 2);
    assert.equal(totals.incompleteRequests, 1);
    assert.equal(totals.outputTokens, 501);
    assert.equal(totals.webSearches, 4);
    assert.equal(totals.webFetches, 2);
  });
});

describe('createLimiter', () => {
  it('runs at most three tasks at once, in order', async () => {
    const run = createLimiter(3);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const task = (n: number) => async () => {
      started.push(n);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, n % 2 ? 5 : 1));
      active--;
      return n;
    };
    const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => run(task(n))));
    assert.deepEqual(results, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(started, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(peak, 3);
    assert.equal(await run(task(9)), 9);
  });

  it('starts waiting tasks by priority, then in call order', async () => {
    const run = createLimiter(1);
    const order: string[] = [];
    const task = (name: string) => async () => {
      order.push(name);
      await new Promise((resolve) => setTimeout(resolve, 1));
    };
    await Promise.all([
      run(task('first'), 3),
      run(task('verify-1'), 3),
      run(task('verify-2'), 3),
      run(task('skeptic'), 1),
      run(task('discover'), 0),
    ]);
    assert.deepEqual(order, ['first', 'discover', 'skeptic', 'verify-1', 'verify-2']);
  });
});

describe('prompts', () => {
  it('keep dates and years out of the system prompt and tools, so they cache and never go stale', () => {
    assert.doesNotMatch(SYSTEM_PROMPT, /\b20\d\d\b/);
    for (const tool of SUBMIT_TOOLS) assert.doesNotMatch(JSON.stringify(tool), /\b20\d\d\b/, tool.name);
  });

  it('share one cached block across discovery angles', () => {
    const known = [deal()];
    const [a, b] = ANGLES.map((angle) => discoverContent(angle, known, TODAY));
    assert.deepEqual(a[0], b[0]);
    assert.notDeepEqual(a[1], b[1]);
    assert.equal(new Set(ANGLES.map((x) => x.name)).size, 7);
  });
});
