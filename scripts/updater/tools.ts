// The submit tools the model calls to hand back results, as strict JSON schemas plus zod mirrors that
// re-check what comes back. Strict schemas allow only 16 union-typed parameters per request, so optional
// deal fields use "" / [] / false for "none" instead of null; convert.ts strips those.
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { CARD_IDS, CATEGORIES, CHANNELS, PERIODS, STATUSES } from '../../src/lib/schema';

type JsonSchema = Record<string, unknown>;
type ObjectSchema = Anthropic.Beta.BetaTool.InputSchema & { additionalProperties: false; required: string[] };

const str = (description: string): JsonSchema => ({ type: 'string', description });
const bool = (description: string): JsonSchema => ({ type: 'boolean', description });
const num = (description: string): JsonSchema => ({ type: 'number', description });
const list = (items: JsonSchema, description: string): JsonSchema => ({ type: 'array', items, description });
const oneOf = (values: readonly string[], description: string): JsonSchema => ({
  type: 'string',
  enum: [...values],
  description,
});
const orNull = (schema: JsonSchema, description: string): JsonSchema => ({
  anyOf: [schema, { type: 'null' }],
  description,
});

/** Strict mode wants every property required and no extras, so obj() always does both. */
function obj(properties: Record<string, JsonSchema>, description?: string): ObjectSchema {
  return {
    type: 'object',
    ...(description ? { description } : {}),
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export const VERIFY_ACTIONS = ['keep', 'update', 'remove'] as const;
export const REMOVE_REASONS = ['expired', 'wrong', 'not-in-san-antonio', 'no-evidence'] as const;
export const REVIEW_ACTIONS = ['keep', 'update', 'remove', 'add'] as const;

const DEAL = obj({
  restaurant: str('Brand name as the brand writes it, e.g. "McDonald\'s", "Chick-fil-A".'),
  title: str('Short, specific offer without the restaurant name, under 60 characters.'),
  details: str('What you get, minimum purchase, limits, how to redeem. "" if nothing to add.'),
  category: oneOf(CATEGORIES, 'freebie | app | deal | card | delivery, as defined in the instructions.'),
  channel: oneOf([...CHANNELS, ''], 'How to redeem it. "" if unknown.'),
  code: str('Promo code exactly as published, or "".'),
  card: oneOf([...CARD_IDS, ''], 'Issuer card for card-linked offers, or "".'),
  local: bool('True only when limited to San Antonio-area locations or a local event.'),
  location: str('Address, neighborhood or venue for local deals, or "".'),
  start: str('First valid day, YYYY-MM-DD (San Antonio date).'),
  end: str('Last valid day, inclusive, YYYY-MM-DD. "" only for ongoing perks with no announced end.'),
  days: list(
    { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6] },
    'Weekdays it runs, 0 = Sunday ... 6 = Saturday. [] when it runs every day of the range.',
  ),
  startTime: str('HH:MM, 24-hour San Antonio time, or "".'),
  endTime: str('HH:MM, 24-hour San Antonio time, or "".'),
  tags: list({ type: 'string' }, 'Lowercase tags, e.g. signup, birthday, veterans, targeted. [] if none.'),
  status: oneOf(STATUSES, 'confirmed only with the brand\'s own source or two reputable recent sources.'),
  sourceUrl: str('Best URL you actually saw for this deal, preferring the brand\'s own page. "" if none.'),
  sourceName: str('Name of that source, e.g. "Whataburger newsroom" or "KSAT". "" if none.'),
  notes: str('Caveats such as "first 100 guests" or "Targeted: check your account." "" if none.'),
});

const VERDICT = obj({
  id: str('The deal id exactly as given.'),
  action: oneOf(VERIFY_ACTIONS, 'keep it as is, update it with corrections, or remove it.'),
  confirmed: bool(
    'True only if this check found the brand\'s own source or two reputable recent sources showing the deal as ' +
      'described (after your corrections).',
  ),
  removeReason: oneOf([...REMOVE_REASONS, ''], 'Why it should be removed; "" unless action is remove.'),
  reason: str('One or two sentences: what you found and where.'),
  evidenceUrl: str('The URL that best backs this verdict, or "".'),
  corrected: orNull(DEAL, 'For update: the full corrected deal, unchanged fields copied exactly. Else null.'),
});

const BENEFIT = obj({
  card: oneOf(CARD_IDS, 'Issuer card.'),
  cardName: str('Exact product when only one variant gets it ("Capital One Savor"), or "" for every variant.'),
  title: str('Short name, e.g. "$10 monthly dining credit".'),
  amount: num('Dollar value per period, or 0 when there is no fixed amount.'),
  period: oneOf(PERIODS, 'How often it resets; none for perks that never reset.'),
  merchants: list({ type: 'string' }, 'Where it can be used. [] if anywhere.'),
  enrollment: bool('True when the cardholder must enroll or activate it first.'),
  details: str('One or two sentences on how it works.'),
  howToUse: str('Steps to use it, or "".'),
  sourceUrl: str('Issuer page that shows it, or "".'),
  notes: str('Caveats, or "".'),
});

const BENEFIT_REVIEW = obj({
  id: str('Existing benefit id, or "" for add.'),
  action: oneOf(REVIEW_ACTIONS, 'keep, update or remove an existing benefit, or add a missing one.'),
  confirmed: bool('True when the issuer\'s own page shows it as described.'),
  reason: str('One sentence: what you found.'),
  sourceUrl: str('The page that backs this review, or "".'),
  benefit: orNull(BENEFIT, 'For update and add: the complete benefit. Else null.'),
});

const CARD_INFO = obj({
  card: oneOf(CARD_IDS, 'Issuer card family.'),
  name: str('Full product name, e.g. "Capital One Savor Cash Rewards Credit Card".'),
  annualFee: num('Annual fee in dollars, or -1 if unknown.'),
  earn: list(
    obj({
      rate: str('e.g. "4X" or "3%".'),
      category: str('e.g. "Restaurants worldwide".'),
      cap: str('Spending cap, e.g. "$50,000/yr", or "".'),
    }),
    'Food-related earn rates (dining, delivery, groceries) plus the base rate.',
  ),
  notes: str('Anything else food-related worth knowing, or "".'),
  sourceUrl: str('Issuer page, or "".'),
});

const CARD_REVIEW = obj({
  id: str('Existing card id, or "" for add.'),
  action: oneOf(REVIEW_ACTIONS, 'keep, update or remove an existing card, or add a missing variant.'),
  reason: str('One sentence: what you found.'),
  sourceUrl: str('The page that backs this review, or "".'),
  info: orNull(CARD_INFO, 'For update and add: the complete card. Else null.'),
});

export const SUBMIT_DEALS = 'submit_deals';
export const SUBMIT_VERDICTS = 'submit_verdicts';
export const SUBMIT_BENEFITS = 'submit_benefits';

export const submitDealsTool: Anthropic.Beta.BetaTool = {
  name: SUBMIT_DEALS,
  description:
    'Hand back the new deals you found. Call it once, at the end, with every deal (an empty list if none). ' +
    'Only include deals backed by a page you saw in this conversation.',
  strict: true,
  input_schema: obj({
    deals: list(DEAL, 'New deals, each one backed by a source you saw.'),
    notes: str('Leads you could not confirm or anything else worth passing on, briefly. "" if none.'),
  }),
};

export const submitVerdictsTool: Anthropic.Beta.BetaTool = {
  name: SUBMIT_VERDICTS,
  description:
    'Hand back one verdict per deal you were asked to check. Call it once, at the end, covering every id.',
  strict: true,
  input_schema: obj({ verdicts: list(VERDICT, 'One verdict per deal id.') }),
};

export const submitBenefitsTool: Anthropic.Beta.BetaTool = {
  name: SUBMIT_BENEFITS,
  description:
    'Hand back your review of the card benefits and card earn rates. Call it once, at the end. Cover every ' +
    'existing id; add entries only for food or delivery benefits that are missing.',
  strict: true,
  input_schema: obj({
    benefits: list(BENEFIT_REVIEW, 'One review per existing benefit, plus any additions.'),
    cards: list(CARD_REVIEW, 'One review per existing card, plus any additions.'),
  }),
};

export const SUBMIT_TOOLS = [submitDealsTool, submitVerdictsTool, submitBenefitsTool];

// Zod mirrors of the schemas above.

const ToolDealZ = z.object({
  restaurant: z.string(),
  title: z.string(),
  details: z.string(),
  category: z.enum(CATEGORIES),
  channel: z.enum(['', ...CHANNELS]),
  code: z.string(),
  card: z.enum(['', ...CARD_IDS]),
  local: z.boolean(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.array(z.number().int()),
  startTime: z.string(),
  endTime: z.string(),
  tags: z.array(z.string()),
  status: z.enum(STATUSES),
  sourceUrl: z.string(),
  sourceName: z.string(),
  notes: z.string(),
});
export type ToolDeal = z.infer<typeof ToolDealZ>;

const VerdictZ = z.object({
  id: z.string(),
  action: z.enum(VERIFY_ACTIONS),
  confirmed: z.boolean(),
  removeReason: z.enum(['', ...REMOVE_REASONS]),
  reason: z.string(),
  evidenceUrl: z.string(),
  corrected: ToolDealZ.nullable(),
});
export type Verdict = z.infer<typeof VerdictZ>;

const ToolBenefitZ = z.object({
  card: z.enum(CARD_IDS),
  cardName: z.string(),
  title: z.string(),
  amount: z.number(),
  period: z.enum(PERIODS),
  merchants: z.array(z.string()),
  enrollment: z.boolean(),
  details: z.string(),
  howToUse: z.string(),
  sourceUrl: z.string(),
  notes: z.string(),
});
export type ToolBenefit = z.infer<typeof ToolBenefitZ>;

const BenefitReviewZ = z.object({
  id: z.string(),
  action: z.enum(REVIEW_ACTIONS),
  confirmed: z.boolean(),
  reason: z.string(),
  sourceUrl: z.string(),
  benefit: ToolBenefitZ.nullable(),
});
export type BenefitReview = z.infer<typeof BenefitReviewZ>;

const ToolCardZ = z.object({
  card: z.enum(CARD_IDS),
  name: z.string(),
  annualFee: z.number(),
  earn: z.array(z.object({ rate: z.string(), category: z.string(), cap: z.string() })),
  notes: z.string(),
  sourceUrl: z.string(),
});
export type ToolCard = z.infer<typeof ToolCardZ>;

const CardReviewZ = z.object({
  id: z.string(),
  action: z.enum(REVIEW_ACTIONS),
  reason: z.string(),
  sourceUrl: z.string(),
  info: ToolCardZ.nullable(),
});
export type CardReview = z.infer<typeof CardReviewZ>;

export const SubmitDealsZ = z.object({ deals: z.array(ToolDealZ), notes: z.string() });
export type SubmitDeals = z.infer<typeof SubmitDealsZ>;
export const SubmitVerdictsZ = z.object({ verdicts: z.array(VerdictZ) });
export type SubmitVerdicts = z.infer<typeof SubmitVerdictsZ>;
export const SubmitBenefitsZ = z.object({ benefits: z.array(BenefitReviewZ), cards: z.array(CardReviewZ) });
export type SubmitBenefits = z.infer<typeof SubmitBenefitsZ>;
