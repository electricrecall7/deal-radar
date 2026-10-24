import type { CardId, Category, Channel } from './schema';

export const CATEGORY_META: Record<Category, { label: string; short: string; emoji: string; color: string }> = {
  freebie: { label: 'Free food', short: 'Free', emoji: '🆓', color: '#2B8A3E' },
  // One step darker than #1C7ED6, where white and dark text both fell short on a selected chip.
  app: { label: 'App offers', short: 'App', emoji: '📱', color: '#1971C2' },
  deal: { label: 'Deals & codes', short: 'Deal', emoji: '🏷️', color: '#E8590C' },
  card: { label: 'Card offers', short: 'Card', emoji: '💳', color: '#7048E8' },
  delivery: { label: 'Delivery promos', short: 'Delivery', emoji: '🛵', color: '#0C8599' },
};

export const CARD_META: Record<CardId, { name: string; short: string; color: string }> = {
  'amex-gold': { name: 'Amex Gold', short: 'Gold', color: '#B8860B' },
  'amex-platinum': { name: 'Amex Platinum', short: 'Plat', color: '#7A869A' },
  'capital-one': { name: 'Capital One', short: 'Cap One', color: '#C8102E' },
  citi: { name: 'Citi', short: 'Citi', color: '#056DAE' },
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  app: 'In the app',
  'in-store': 'In store',
  online: 'Online order',
  'drive-thru': 'Drive-thru',
  delivery: 'Delivery app',
  card: 'Pay with card',
  any: 'Any order',
};
