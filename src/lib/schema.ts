// Shape of data/deals.json. Shared by the app and the weekly updater script,
// so keep this file free of React Native imports.
import { z } from 'zod';

export const CATEGORIES = ['freebie', 'app', 'deal', 'card', 'delivery'] as const;
export const CHANNELS = ['app', 'in-store', 'online', 'drive-thru', 'delivery', 'card', 'any'] as const;
export const CARD_IDS = ['amex-gold', 'amex-platinum', 'capital-one', 'citi'] as const;
export const PERIODS = ['monthly', 'quarterly', 'semiannual', 'annual', 'none'] as const;
export const STATUSES = ['confirmed', 'unconfirmed'] as const;

export type Category = (typeof CATEGORIES)[number];
export type Channel = (typeof CHANNELS)[number];
export type CardId = (typeof CARD_IDS)[number];
export type Period = (typeof PERIODS)[number];

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

export const DealSchema = z.object({
  id: z.string().min(1),
  restaurant: z.string().min(1),
  title: z.string().min(1),
  details: z.string().optional(),
  category: z.enum(CATEGORIES),
  channel: z.enum(CHANNELS).optional(),
  code: z.string().optional(),
  card: z.enum(CARD_IDS).optional(),
  /** Only redeemable at San Antonio-area locations or events. */
  local: z.boolean().optional(),
  location: z.string().optional(),
  /** First valid day (local San Antonio date). */
  start: ymd,
  /** Last valid day, inclusive. Missing means ongoing. */
  end: ymd.optional(),
  /** Weekdays the deal runs, 0 = Sunday. Missing means every day of the range. */
  days: z.array(z.number().int().min(0).max(6)).optional(),
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(STATUSES),
  sourceUrl: z.string().optional(),
  sourceName: z.string().optional(),
  notes: z.string().optional(),
  firstSeen: ymd.optional(),
  verifiedAt: ymd.optional(),
  /** Last day the weekly check looked at it, whatever the verdict. */
  checkedAt: ymd.optional(),
  /** Added by hand on the phone; never comes from deals.json. */
  custom: z.boolean().optional(),
});
export type Deal = z.infer<typeof DealSchema>;

export const BenefitSchema = z.object({
  id: z.string().min(1),
  card: z.enum(CARD_IDS),
  /** Exact product, e.g. "Capital One Savor". Missing means every variant of `card`. */
  cardName: z.string().optional(),
  title: z.string().min(1),
  amount: z.number().optional(),
  period: z.enum(PERIODS),
  merchants: z.array(z.string()).optional(),
  enrollment: z.boolean().optional(),
  details: z.string(),
  howToUse: z.string().optional(),
  status: z.enum(STATUSES),
  sourceUrl: z.string().optional(),
  notes: z.string().optional(),
  verifiedAt: ymd.optional(),
});
export type Benefit = z.infer<typeof BenefitSchema>;

export const CardInfoSchema = z.object({
  id: z.string().min(1),
  card: z.enum(CARD_IDS),
  name: z.string().min(1),
  annualFee: z.number().optional(),
  earn: z.array(z.object({ rate: z.string(), category: z.string(), cap: z.string().optional() })),
  notes: z.string().optional(),
  sourceUrl: z.string().optional(),
});
export type CardInfo = z.infer<typeof CardInfoSchema>;

export const ResourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().optional(),
  kind: z.enum(['app', 'site', 'reddit', 'newsletter', 'social']),
  why: z.string(),
  checkWhen: z.string().optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;

export const DealsFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  region: z.string(),
  deals: z.array(DealSchema),
  benefits: z.array(BenefitSchema),
  cards: z.array(CardInfoSchema),
  resources: z.array(ResourceSchema),
});
export type DealsFile = z.infer<typeof DealsFileSchema>;

/**
 * Parse a deals file leniently: one bad entry is dropped instead of rejecting
 * the whole weekly update.
 */
export function parseDealsFile(json: unknown): { file: DealsFile; dropped: number } {
  const root = z
    .object({
      version: z.literal(1),
      updatedAt: z.string(),
      region: z.string().default('San Antonio, TX'),
      deals: z.array(z.unknown()).default([]),
      benefits: z.array(z.unknown()).default([]),
      cards: z.array(z.unknown()).default([]),
      resources: z.array(z.unknown()).default([]),
    })
    .parse(json);

  let dropped = 0;
  function keep<T>(schema: z.ZodType<T>, items: unknown[]): T[] {
    const out: T[] = [];
    for (const item of items) {
      const r = schema.safeParse(item);
      if (r.success) out.push(r.data);
      else dropped++;
    }
    return out;
  }

  return {
    file: {
      version: 1,
      updatedAt: root.updatedAt,
      region: root.region,
      deals: keep(DealSchema, root.deals),
      benefits: keep(BenefitSchema, root.benefits),
      cards: keep(CardInfoSchema, root.cards),
      resources: keep(ResourceSchema, root.resources),
    },
    dropped,
  };
}
