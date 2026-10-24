// Which card product the user holds per issuer, and which benefits apply to it.
import type { Benefit, CardInfo } from './schema';

/** The stored choice, or the first listed variant when nothing (or a since-removed id) is stored. */
export function selectedVariant(variants: CardInfo[], storedId: string | undefined): CardInfo | undefined {
  return variants.find((v) => v.id === storedId) ?? variants[0];
}

// "American Express Gold Card®" and "Amex Gold" should compare equal, so drop marks,
// punctuation and filler words before comparing.
function normalizeName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/american express/g, 'amex')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && w !== 'the' && w !== 'card');
  return ` ${words.join(' ')} `;
}

/**
 * Benefits without cardName apply to every variant. Otherwise the names must contain one another,
 * matched on whole words so "Savor" does not match "SavorOne".
 */
export function benefitAppliesTo(b: Benefit, variant: CardInfo | undefined): boolean {
  if (!b.cardName || !variant) return true;
  const a = normalizeName(b.cardName);
  const v = normalizeName(variant.name);
  if (!a.trim() || !v.trim()) return true;
  return a.includes(v) || v.includes(a);
}

/** Whether a benefit belongs to the card variant the user picked for that issuer. */
export function benefitAppliesToUser(
  b: Benefit,
  cards: CardInfo[],
  cardVariants: Partial<Record<string, string>>,
): boolean {
  const variants = cards.filter((c) => c.card === b.card);
  return benefitAppliesTo(b, selectedVariant(variants, cardVariants[b.card]));
}

const FILLER =/\b(the|card|from|credit|american express|amex|capital one|citi)\b/gi;

/** "Capital One Savor Cash Rewards Credit Card" -> "Savor Cash Rewards", for chips. */
export function shortVariantName(name: string): string {
  const short = name.replace(/[®℠™]/g, '').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return short || name;
}
