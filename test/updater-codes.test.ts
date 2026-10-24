import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Deal } from '../src/lib/schema';
import { buildCodeWatchlist, CODES_ANGLE, promoCodeAngles } from '../scripts/updater/codes';
import { parseArgs } from '../scripts/updater/config';

function deal(restaurant: string, over: Partial<Deal> = {}): Deal {
  return { id: `${restaurant}-${Math.random()}`, restaurant, title: 'x', category: 'deal', start: '2026-10-24', status: 'confirmed', ...over };
}

describe('buildCodeWatchlist', () => {
  it('keeps the hand-kept list first and in order', () => {
    assert.deepEqual(buildCodeWatchlist(['Whataburger', 'Taco Cabana'], []), ['Whataburger', 'Taco Cabana']);
  });

  it('adds restaurants with two or more deals, most deals first', () => {
    const deals = [deal('KFC'), deal('KFC'), deal('KFC'), deal('Sonic'), deal('Sonic'), deal('Once Only')];
    assert.deepEqual(buildCodeWatchlist([], deals), ['KFC', 'Sonic']);
  });

  it('treats punctuation and spacing variants as one restaurant', () => {
    const deals = [deal("McDonald's"), deal('McDonalds'), deal('Chick fil A'), deal('Chick-fil-A')];
    assert.deepEqual(buildCodeWatchlist(["McDonald's", 'Chick-fil-A'], deals), ["McDonald's", 'Chick-fil-A']);
  });

  it('ignores card-offer merchants, hand-added deals and parenthetical notes', () => {
    const deals = [
      deal('Grubhub', { category: 'card' }),
      deal('Grubhub', { category: 'card' }),
      deal('Mine', { custom: true }),
      deal('Mine', { custom: true }),
      deal('Laredo Taco Company (inside 7-Eleven)'),
      deal('Laredo Taco Company'),
    ];
    assert.deepEqual(buildCodeWatchlist([], deals), ['Laredo Taco Company']);
  });
});

describe('promoCodeAngles', () => {
  it('splits the watchlist into numbered batches', () => {
    const names = Array.from({ length: 25 }, (_, i) => `R${i + 1}`);
    const angles = promoCodeAngles(names, 12);
    assert.deepEqual(angles.map((a) => a.name), [`${CODES_ANGLE}-1`, `${CODES_ANGLE}-2`, `${CODES_ANGLE}-3`]);
    assert.match(angles[0].task, /R1; R2;/);
    assert.match(angles[2].task, /Restaurants: R25\./);
    assert.ok(angles.every((a) => a.searches && a.fetches));
  });

  it('makes nothing for an empty watchlist', () => {
    assert.deepEqual(promoCodeAngles([]), []);
  });
});

describe('parseArgs code flags', () => {
  it('includes the sweep by default', () => {
    assert.equal(parseArgs([]).codes, 'include');
  });

  it('--skip-codes leaves it out', () => {
    assert.equal(parseArgs(['--skip-codes']).codes, 'skip');
  });

  it('--only-codes skips verification and benefits', () => {
    const o = parseArgs(['--only-codes']);
    assert.equal(o.codes, 'only');
    assert.equal(o.skipVerify, true);
    assert.equal(o.skipBenefits, true);
  });
});
