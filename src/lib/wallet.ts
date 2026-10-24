// The cards the user actually holds. The app shows only these, and the deal search only researches
// these; any other card or card-specific benefit in deals.json is dropped.
import type { Benefit, CardId, CardInfo, DealsFile } from './schema';

export interface HeldCard {
  card: CardId;
  name: string;
  /**
   * Whole words that pick this product out of the issuer's other cards ("quicksilver" but not
   * "QuicksilverOne"). Missing when the issuer id already names the product (Amex Gold).
   */
  match?: string;
}

export const MY_CARDS: readonly HeldCard[] = [
  { card: 'amex-gold', name: 'American Express Gold Card' },
  { card: 'amex-platinum', name: 'The Platinum Card from American Express' },
  { card: 'capital-one', name: 'Capital One Quicksilver Cash Rewards Credit Card', match: 'quicksilver' },
  { card: 'citi', name: 'Citi Custom Cash Card', match: 'custom cash' },
  { card: 'citi', name: 'Citi Simplicity Card', match: 'simplicity' },
];

const words = (name: string) => ` ${name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ')} `;

/** Whether a product name (for example a benefit's cardName) is this held card. */
export function namesHeldCard(held: HeldCard, card: CardId, name: string): boolean {
  return held.card === card && (!held.match || words(name).includes(` ${held.match} `));
}

export function isHeldCard(info: Pick<CardInfo, 'card' | 'name'>): boolean {
  return MY_CARDS.some((h) => namesHeldCard(h, info.card, info.name));
}

/** A benefit without cardName goes with every card of its issuer; one with cardName needs that card. */
export function isHeldBenefit(b: Pick<Benefit, 'card' | 'cardName'>): boolean {
  if (!b.cardName?.trim()) return MY_CARDS.some((h) => h.card === b.card);
  return isHeldCard({ card: b.card, name: b.cardName });
}

/** The deals file without cards the user doesn't hold, or their benefits. */
export function onlyHeldCards(file: DealsFile): DealsFile {
  return { ...file, cards: file.cards.filter(isHeldCard), benefits: file.benefits.filter(isHeldBenefit) };
}

const FILLER = /\b(the|card|from|credit|american express|amex|capital one|citi)\b/gi;

/** "Capital One Quicksilver Cash Rewards Credit Card" -> "Quicksilver Cash Rewards", for labels. */
export function shortCardName(name: string): string {
  const short = name.replace(/[®℠™]/g, '').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return short || name;
}
