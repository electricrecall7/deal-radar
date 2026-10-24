// Turns what the model submits into schema.ts objects: "" / [] / false become missing fields, loose
// dates and times are normalized, and anything that still fails the schema is rejected with a reason.
import { pad2 } from '../../src/lib/dates';
import {
  BenefitSchema,
  CardInfoSchema,
  DealSchema,
  ResourceSchema,
  type Benefit,
  type CardInfo,
  type Deal,
} from '../../src/lib/schema';
import type { ToolBenefit, ToolCard, ToolDeal } from './tools';

/** "2026-11-3" -> "2026-11-03"; anything that isn't a real calendar day -> undefined. */
export function normalizeDate(s: string): string | undefined {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** "13:00", "1:00 PM", "1pm", "12 AM" -> "HH:MM" (24h); unparseable -> undefined. */
export function normalizeTime(s: string): string | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i.exec(s.trim());
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (min > 59) return undefined;
  if (meridiem) {
    if (h < 1 || h > 12) return undefined;
    if (meridiem === 'a' && h === 12) h = 0;
    if (meridiem === 'p' && h !== 12) h += 12;
  } else if (!m[2]) {
    // A bare "13" is ambiguous enough to drop.
    return undefined;
  }
  if (h === 24 && min === 0) return '23:59';
  if (h > 23) return undefined;
  return `${pad2(h)}:${pad2(min)}`;
}

const text = (s: string | undefined) => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : undefined;
};

const url = (s: string | undefined) => {
  const t = s?.trim();
  return t && /^https?:\/\/\S+$/i.test(t) ? t : undefined;
};

function cleanList(items: string[], lower = false): string[] | undefined {
  const out: string[] = [];
  for (const item of items) {
    const t = text(lower ? item.toLowerCase() : item);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

/** Sorted unique weekdays; every day of the week means no restriction. */
export function normalizeDays(days: number[]): number[] | undefined {
  const set = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  return set.length === 0 || set.length === 7 ? undefined : set;
}

export const TARGETED_NOTE = 'Targeted: check your account.';

/** Card-linked offers differ per account, so they can never be confirmed for this user. */
export function enforceTargeted(deal: Deal): Deal {
  if (!deal.tags?.includes('targeted')) return deal;
  const notes = deal.notes?.toLowerCase().includes('targeted')
    ? deal.notes
    : text(`${TARGETED_NOTE} ${deal.notes ?? ''}`);
  return { ...deal, status: 'unconfirmed', notes };
}

export type Converted<T> = { ok: true; value: T } | { ok: false; error: string };

/** Drops keys whose value is undefined, so written objects only carry fields that are set. */
export function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function firstIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.map(String).join('.') || 'value'}: ${issue.message}` : 'invalid';
}

export function toDeal(
  t: ToolDeal,
  keep: { id: string; firstSeen?: string; verifiedAt?: string; custom?: boolean },
): Converted<Deal> {
  const start = normalizeDate(t.start);
  if (!start) return { ok: false, error: `bad start date "${t.start}"` };
  const end = t.end.trim() ? normalizeDate(t.end) : undefined;
  if (t.end.trim() && !end) return { ok: false, error: `bad end date "${t.end}"` };
  if (end && end < start) return { ok: false, error: `end ${end} is before start ${start}` };

  const deal: Deal = {
    id: keep.id,
    restaurant: text(t.restaurant) ?? '',
    title: text(t.title) ?? '',
    details: text(t.details),
    category: t.category,
    channel: t.channel || undefined,
    code: text(t.code),
    card: t.card || undefined,
    local: t.local || undefined,
    location: text(t.location),
    start,
    end,
    days: normalizeDays(t.days),
    startTime: t.startTime.trim() ? normalizeTime(t.startTime) : undefined,
    endTime: t.endTime.trim() ? normalizeTime(t.endTime) : undefined,
    tags: cleanList(t.tags, true),
    status: t.status,
    sourceUrl: url(t.sourceUrl),
    sourceName: text(t.sourceName),
    notes: text(t.notes),
    firstSeen: keep.firstSeen,
    verifiedAt: keep.verifiedAt,
    custom: keep.custom,
  };
  const parsed = DealSchema.safeParse(compact(enforceTargeted(deal)));
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: firstIssue(parsed.error) };
}

const NOT_FOR_PROMPT = new Set(['firstSeen', 'checkedAt', 'custom']);

/** The shape the model sees for an existing deal: only fields that are set, no bookkeeping. */
export function dealForPrompt(d: Deal): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) {
    if (value !== undefined && !NOT_FOR_PROMPT.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Why each entry that parseDealsFile would drop fails the schema, e.g.
 * `deals[3] (taco-tuesday): start: expected YYYY-MM-DD`. Rewriting the file would delete them for good.
 */
export function invalidEntries(json: unknown): string[] {
  const root = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const lists = [
    ['deals', DealSchema],
    ['benefits', BenefitSchema],
    ['cards', CardInfoSchema],
    ['resources', ResourceSchema],
  ] as const;
  const out: string[] = [];
  for (const [key, schema] of lists) {
    const items = root[key];
    if (!Array.isArray(items)) continue;
    items.forEach((item: unknown, i) => {
      const parsed = schema.safeParse(item);
      if (parsed.success) return;
      const named = (item && typeof item === 'object' ? item : {}) as { id?: unknown; name?: unknown };
      const name = typeof named.id === 'string' ? named.id : named.name;
      const where = typeof name === 'string' && name ? `${key}[${i}] (${name})` : `${key}[${i}]`;
      out.push(`${where}: ${firstIssue(parsed.error)}`);
    });
  }
  return out;
}

export function toBenefit(
  t: ToolBenefit,
  keep: { id: string; status: Benefit['status']; verifiedAt?: string },
): Converted<Benefit> {
  const benefit: Benefit = {
    id: keep.id,
    card: t.card,
    cardName: text(t.cardName),
    title: text(t.title) ?? '',
    amount: t.amount > 0 ? t.amount : undefined,
    period: t.period,
    merchants: cleanList(t.merchants),
    enrollment: t.enrollment || undefined,
    details: text(t.details) ?? '',
    howToUse: text(t.howToUse),
    status: keep.status,
    sourceUrl: url(t.sourceUrl),
    notes: text(t.notes),
    verifiedAt: keep.verifiedAt,
  };
  const parsed = BenefitSchema.safeParse(compact(benefit));
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: firstIssue(parsed.error) };
}

export function toCardInfo(t: ToolCard, id: string): Converted<CardInfo> {
  const card: CardInfo = {
    id,
    card: t.card,
    name: text(t.name) ?? '',
    annualFee: t.annualFee >= 0 ? t.annualFee : undefined,
    earn: t.earn
      .map((e) => compact({ rate: text(e.rate) ?? '', category: text(e.category) ?? '', cap: text(e.cap) }))
      .filter((e) => e.rate && e.category),
    notes: text(t.notes),
    sourceUrl: url(t.sourceUrl),
  };
  const parsed = CardInfoSchema.safeParse(compact(card));
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: firstIssue(parsed.error) };
}
