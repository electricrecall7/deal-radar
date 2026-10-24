import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DealsFile } from '../src/lib/schema';
import { isHeldBenefit, isHeldCard, onlyHeldCards, shortCardName } from '../src/lib/wallet';

describe('isHeldCard', () => {
  it('keeps the five cards the user holds', () => {
    assert.equal(isHeldCard({ card: 'amex-gold', name: 'American Express Gold Card' }), true);
    assert.equal(isHeldCard({ card: 'amex-platinum', name: 'The Platinum Card from American Express' }), true);
    assert.equal(isHeldCard({ card: 'capital-one', name: 'Capital One Quicksilver Cash Rewards Credit Card' }), true);
    assert.equal(isHeldCard({ card: 'citi', name: 'Citi Custom Cash® Card' }), true);
    assert.equal(isHeldCard({ card: 'citi', name: 'Citi Simplicity® Card' }), true);
  });

  it('drops other products from the same issuers, matching whole words', () => {
    assert.equal(isHeldCard({ card: 'capital-one', name: 'Capital One Savor Cash Rewards Credit Card' }), false);
    assert.equal(isHeldCard({ card: 'capital-one', name: 'Capital One QuicksilverOne Cash Rewards' }), false);
    assert.equal(isHeldCard({ card: 'citi', name: 'Citi Double Cash Card' }), false);
    assert.equal(isHeldCard({ card: 'citi', name: 'Citi Strata Elite Card' }), false);
  });
});

describe('isHeldBenefit', () => {
  it('keeps issuer-wide benefits and ones naming a held card', () => {
    assert.equal(isHeldBenefit({ card: 'citi' }), true);
    assert.equal(isHeldBenefit({ card: 'citi', cardName: '' }), true);
    assert.equal(isHeldBenefit({ card: 'citi', cardName: 'Citi Custom Cash Card' }), true);
    assert.equal(isHeldBenefit({ card: 'amex-platinum', cardName: 'Amex Platinum' }), true);
  });

  it('drops benefits of cards the user does not hold', () => {
    assert.equal(isHeldBenefit({ card: 'citi', cardName: 'Citi Strata Elite Card' }), false);
    assert.equal(isHeldBenefit({ card: 'capital-one', cardName: 'Capital One Savor' }), false);
  });
});

describe('onlyHeldCards', () => {
  it('filters cards and benefits and leaves deals alone', () => {
    const file: DealsFile = {
      version: 1,
      updatedAt: '2026-10-24',
      region: 'San Antonio, TX',
      deals: [],
      resources: [],
      cards: [
        { id: 'qs', card: 'capital-one', name: 'Capital One Quicksilver', earn: [] },
        { id: 'vx', card: 'capital-one', name: 'Capital One Venture X', earn: [] },
      ],
      benefits: [
        { id: 'b1', card: 'citi', cardName: 'Citi Strata Elite Card', title: '6x', period: 'none', details: '', status: 'confirmed' },
        { id: 'b2', card: 'citi', title: 'Merchant Offers', period: 'none', details: '', status: 'confirmed' },
      ],
    };
    const out = onlyHeldCards(file);
    assert.deepEqual(out.cards.map((c) => c.id), ['qs']);
    assert.deepEqual(out.benefits.map((b) => b.id), ['b2']);
  });
});

describe('shortCardName', () => {
  it('trims issuer names and filler for labels', () => {
    assert.equal(shortCardName('Citi Custom Cash Card'), 'Custom Cash');
    assert.equal(shortCardName('Citi Simplicity® Card'), 'Simplicity');
  });
});
