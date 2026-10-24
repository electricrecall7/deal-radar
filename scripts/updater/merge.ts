// Pure merge rules for the weekly update: pruning, verdicts, dedupe, ids and benefit reviews.
// Everything here is deterministic so test/updater.test.ts can pin it down.
import { addDays } from '../../src/lib/dates';
import { restaurantKey } from '../../src/lib/prefs';
import { DealsFileSchema, type Benefit, type CardInfo, type Deal, type DealsFile } from '../../src/lib/schema';
import { VERIFY_FRESH_DAYS } from './config';
import { enforceTargeted, toBenefit, toCardInfo, toDeal } from './convert';
import type { BenefitReview, CardReview, Verdict } from './tools';

/** One line in the run summary: what happened to a deal, benefit or card, and why. */
export interface Change {
  id: string;
  restaurant?: string;
  title: string;
  reason: string;
  detail?: string;
  fields?: string[];
}

function change(d: Deal, reason: string, detail?: string, fields?: string[]): Change {
  return { id: d.id, restaurant: d.restaurant, title: d.title, reason, detail: detail || undefined, fields };
}

/** Today's date in San Antonio, whatever zone the CI runner uses. */
export function chicagoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const validUrl = (s: string | undefined) => (s && /^https?:\/\/\S+$/i.test(s.trim()) ? s.trim() : undefined);

// ---- Pruning and verification ----

export function pruneEnded(deals: Deal[], today: string): { kept: Deal[]; removed: Change[] } {
  const kept: Deal[] = [];
  const removed: Change[] = [];
  for (const d of deals) {
    if (d.end && d.end < today) removed.push(change(d, 'ended', `last day was ${d.end}`));
    else kept.push(d);
  }
  return { kept, removed };
}

/** Plain code-unit order for dates and ids, so sorting never depends on the runner's locale. */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Deals due for a check, least recently checked first, so --limit and the time budget spread checks
 * across weeks. Custom deals and deals checked in the last `freshDays` days are left out. Going by
 * checkedAt, not verifiedAt, keeps deals that never confirm from holding the front of the queue forever.
 */
export function pickForVerify(
  deals: Deal[],
  today: string,
  limit?: number,
  freshDays = VERIFY_FRESH_DAYS,
): { due: Deal[]; fresh: number } {
  const cutoff = addDays(today, -freshDays);
  // Never checked is '', so it is always due and goes first.
  const lastChecked = (d: Deal) => d.checkedAt ?? d.verifiedAt ?? '';
  const eligible = deals.filter((d) => !d.custom);
  const due = eligible
    .filter((d) => lastChecked(d) <= cutoff)
    .sort((a, b) => cmp(lastChecked(a), lastChecked(b)) || cmp(a.start, b.start) || cmp(a.id, b.id));
  return { due: limit === undefined ? due : due.slice(0, limit), fresh: eligible.length - due.length };
}

/** Field names whose values differ, ignoring bookkeeping. */
export function changedFields<T extends object>(
  a: T,
  b: T,
  ignore: string[] = ['verifiedAt', 'checkedAt'],
): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const va = JSON.stringify((a as Record<string, unknown>)[key]);
    const vb = JSON.stringify((b as Record<string, unknown>)[key]);
    if (va !== vb) out.push(key);
  }
  return out.sort();
}

export interface VerdictResult {
  /** Surviving deals, in batch order. */
  deals: Deal[];
  updated: Change[];
  removed: Change[];
  confirmed: number;
  /** Ids the model gave no verdict for; left unchanged. */
  missing: string[];
  /** Verdicts that could not be applied as given. */
  problems: string[];
}

/**
 * Apply one batch of keep / update / remove verdicts. Used for existing deals and, in the skeptic
 * pass, for new candidates. Only an explicit "confirmed" refreshes verifiedAt; a verdict that couldn't
 * re-confirm downgrades the deal to unconfirmed. Any keep or update stamps checkedAt.
 */
export function applyVerdicts(batch: Deal[], verdicts: Verdict[], today: string): VerdictResult {
  const byId = new Map<string, Verdict>();
  for (const v of verdicts) if (!byId.has(v.id.trim())) byId.set(v.id.trim(), v);
  const result: VerdictResult = {
    deals: [],
    updated: [],
    removed: [],
    confirmed: 0,
    missing: [],
    problems: [],
  };

  for (const d of batch) {
    const v = byId.get(d.id);
    if (!v) {
      result.missing.push(d.id);
      result.deals.push(d);
      continue;
    }
    if (v.action === 'remove') {
      result.removed.push(change(d, v.removeReason || 'removed', v.reason));
      continue;
    }

    let next: Deal = d;
    const evidence = validUrl(v.evidenceUrl);
    if (v.action === 'update') {
      const converted = v.corrected
        ? toDeal(v.corrected, { id: d.id, firstSeen: d.firstSeen, verifiedAt: d.verifiedAt, custom: d.custom })
        : ({ ok: false, error: 'update without a corrected deal' } as const);
      if (converted.ok) {
        // Keep provenance when the correction forgot to repeat it.
        next = {
          ...converted.value,
          sourceUrl: converted.value.sourceUrl ?? d.sourceUrl ?? evidence,
          sourceName: converted.value.sourceName ?? d.sourceName,
        };
      } else {
        result.problems.push(`${d.id}: ${converted.error}; kept as is`);
      }
    }
    if (next.end && next.end < today) {
      result.removed.push(change(next, 'expired', v.reason));
      continue;
    }
    if (!next.sourceUrl && evidence) next = { ...next, sourceUrl: evidence };
    next = enforceTargeted(
      v.confirmed
        ? { ...next, status: 'confirmed', verifiedAt: today, checkedAt: today }
        : { ...next, status: 'unconfirmed', checkedAt: today },
    );
    if (next.status === 'confirmed') result.confirmed++;

    const fields = changedFields(d, next);
    const kind = v.action === 'update' ? 'corrected' : 'rechecked';
    if (fields.length > 0) result.updated.push(change(next, kind, v.reason, fields));
    result.deals.push(next);
  }
  return result;
}

// ---- Duplicate detection ----

/** restaurantKey() plus punctuation folding, so "McDonald's" and "McDonalds" match. */
export function dedupeKey(restaurant: string): string {
  return restaurantKey(restaurant)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'with', 'w', 'of', 'on', 'at', 'in', 'and', 'or', 'to', 'your', 'any', 'all', 'get',
  'when', 'you', 'every', 'is', 'are', 'by', 'from',
]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Title words that carry meaning: no stopwords, no restaurant name, plurals folded. */
export function titleTokens(title: string, restaurant = ''): Set<string> {
  const name = new Set(words(restaurant));
  const all = words(title).filter((w) => !STOPWORDS.has(w));
  const meaningful = all.filter((w) => !name.has(w));
  return new Set((meaningful.length > 0 ? meaningful : all).map(stem));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Date ranges overlap (end inclusive, missing end = ongoing) and weekly deals share a weekday. */
export function rangesOverlap(a: Deal, b: Deal): boolean {
  const aEnd = a.end ?? '9999-12-31';
  const bEnd = b.end ?? '9999-12-31';
  if (a.start > bEnd || b.start > aEnd) return false;
  if (a.days?.length && b.days?.length && !a.days.some((day) => b.days?.includes(day))) return false;
  return true;
}

const codeKey = (code: string | undefined) => code?.replace(/\s+/g, '').toUpperCase() || undefined;

/** dedupeKey() without a trailing "(via Grubhub)" or anything after " / ", e.g. "Pizza Hut / DoorDash". */
export function brandKey(restaurant: string): string {
  return dedupeKey(restaurant.replace(/\s+\/\s.*$/, '').replace(/\s*\(.*\)\s*$/, ''));
}

/** Same brand, allowing one name to extend the other ("Sonic" and "Sonic Drive-In"). */
export function sameBrand(a: string, b: string): boolean {
  const ka = brandKey(a);
  const kb = brandKey(b);
  return !!ka && !!kb && (ka.startsWith(kb) || kb.startsWith(ka));
}

export const DUPLICATE_JACCARD = 0.5;

export function isDuplicate(a: Deal, b: Deal): boolean {
  if (!rangesOverlap(a, b)) return false;
  // A shared promo code is strong evidence on its own, so the restaurant only has to be the same brand.
  const ca = codeKey(a.code);
  if (ca && ca === codeKey(b.code) && sameBrand(a.restaurant, b.restaurant)) return true;
  if (dedupeKey(a.restaurant) !== dedupeKey(b.restaurant)) return false;
  return jaccard(titleTokens(a.title, a.restaurant), titleTokens(b.title, b.restaurant)) >= DUPLICATE_JACCARD;
}

/** When two new finds are the same deal, keep the better-sourced one. */
function richness(d: Deal): number {
  return (d.status === 'confirmed' ? 4 : 0) + (d.sourceUrl ? 2 : 0) + (d.details ? 1 : 0);
}

const BOOKKEEPING = new Set(['id', 'status', 'firstSeen', 'verifiedAt', 'checkedAt', 'custom']);

/** How much a deal tells the reader: fields filled in, then the length of its details text. */
function detailScore(d: Deal): [number, number] {
  const filled = Object.entries(d).filter(
    ([key, value]) => !BOOKKEEPING.has(key) && value !== undefined && value !== '',
  ).length;
  return [filled, d.details?.length ?? 0];
}

/** Better copy first: confirmed, then more details, then seen earlier (missing firstSeen predates tracking). */
function compareCopies(a: Deal, b: Deal): number {
  const [fa, la] = detailScore(a);
  const [fb, lb] = detailScore(b);
  return (
    Number(b.status === 'confirmed') - Number(a.status === 'confirmed') ||
    fb - fa ||
    lb - la ||
    cmp(a.firstSeen ?? '', b.firstSeen ?? '') ||
    cmp(a.id, b.id)
  );
}

/**
 * Removes duplicates already in the file, keeping the better copy of each pair. Custom deals are never
 * touched. Kept deals stay in their original order.
 */
export function dedupeExisting(deals: Deal[]): { kept: Deal[]; removed: Change[]; removedDeals: Deal[] } {
  const keep: Deal[] = [];
  const removed: Change[] = [];
  const removedDeals: Deal[] = [];
  // Walking best-first means each copy is compared against the best one already kept.
  for (const d of deals.filter((x) => !x.custom).sort(compareCopies)) {
    const match = keep.find((k) => isDuplicate(d, k));
    if (match) {
      removed.push(change(d, 'duplicate', `same as ${match.id}`));
      removedDeals.push(d);
    } else {
      keep.push(d);
    }
  }
  const gone = new Set(removedDeals);
  return { kept: deals.filter((d) => !gone.has(d)), removed, removedDeals };
}

/** Drop candidates that match a known deal or an earlier candidate. Candidate order is otherwise kept. */
export function dedupeCandidates(candidates: Deal[], known: Deal[]): { unique: Deal[]; duplicates: Change[] } {
  const unique: Deal[] = [];
  const duplicates: Change[] = [];
  for (const c of candidates) {
    const match = known.find((k) => isDuplicate(c, k));
    if (match) {
      duplicates.push(change(c, 'duplicate', `same as ${match.id}`));
      continue;
    }
    const i = unique.findIndex((u) => isDuplicate(c, u));
    if (i < 0) {
      unique.push(c);
    } else if (richness(c) > richness(unique[i])) {
      duplicates.push(change(unique[i], 'duplicate', 'same as another new find'));
      unique[i] = c;
    } else {
      duplicates.push(change(c, 'duplicate', 'same as another new find'));
    }
  }
  return { unique, duplicates };
}

// ---- Ids and output ----

export function slugify(s: string, max = 60): string {
  const slug = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const dash = cut.lastIndexOf('-');
  return (dash > max / 2 ? cut.slice(0, dash) : cut).replace(/-+$/, '');
}

export function uniqueId(base: string, taken: Set<string>): string {
  const root = base || 'item';
  let id = root;
  for (let n = 2; taken.has(id); n++) id = `${root}-${n}`;
  taken.add(id);
  return id;
}

/** New deals get slug(restaurant + title) + start; existing ids never change. */
export function assignIds(fresh: Deal[], existing: Deal[], today: string): Deal[] {
  const taken = new Set(existing.map((d) => d.id));
  return fresh.map((d) => ({
    ...d,
    id: uniqueId(`${slugify(`${d.restaurant} ${d.title}`)}-${d.start}`, taken),
    firstSeen: today,
  }));
}

export function sortDeals(deals: Deal[]): Deal[] {
  return [...deals].sort(
    (a, b) =>
      cmp(a.start, b.start) ||
      a.restaurant.localeCompare(b.restaurant, 'en') ||
      a.title.localeCompare(b.title, 'en') ||
      cmp(a.id, b.id),
  );
}

/** The file to write. Throws instead of returning anything the app could choke on. */
export function buildFile(
  base: DealsFile,
  parts: Pick<DealsFile, 'deals' | 'benefits' | 'cards'>,
  now: Date,
): DealsFile {
  const ids = new Set<string>();
  for (const d of parts.deals) {
    if (ids.has(d.id)) throw new Error(`duplicate deal id ${d.id}`);
    ids.add(d.id);
  }
  return DealsFileSchema.parse({
    version: 1,
    updatedAt: now.toISOString(),
    region: base.region,
    deals: sortDeals(parts.deals),
    benefits: parts.benefits,
    cards: parts.cards,
    resources: base.resources,
  });
}

export function serializeFile(file: unknown): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ---- Card benefits and earn rates ----

export interface ReviewResult<T> {
  items: T[];
  changes: Change[];
  /** Reviews that were not applied, with why. */
  ignored: string[];
}

// One bad answer must not wipe the Cards tab, so a review that would remove more than half the
// entries is treated as a mistake and its removals are skipped.
function guardRemovals<T extends { id: string }>(
  items: T[],
  remove: Map<string, Change>,
  result: ReviewResult<T>,
): T[] {
  if (remove.size === 0) return items;
  if (remove.size > items.length / 2) {
    result.ignored.push(`skipped ${remove.size} removals out of ${items.length}: too many at once`);
    return items;
  }
  result.changes.push(...remove.values());
  return items.filter((item) => !remove.has(item.id));
}

function noteChange(
  result: ReviewResult<unknown>,
  before: object,
  after: object,
  change: Omit<Change, 'fields'>,
): void {
  const fields = changedFields(before, after);
  if (fields.length > 0) result.changes.push({ ...change, fields });
}

const reviewsById = <R extends { id: string; action: string }>(reviews: R[]) =>
  new Map(reviews.filter((r) => r.action !== 'add' && r.id).map((r) => [r.id.trim(), r]));

/**
 * Apply the benefits review. Entries change only when the review cites a source; anything the review
 * leaves out stays as it was.
 */
export function applyBenefitReviews(
  existing: Benefit[],
  reviews: BenefitReview[],
  today: string,
): ReviewResult<Benefit> {
  const result: ReviewResult<Benefit> = { items: [], changes: [], ignored: [] };
  const byId = reviewsById(reviews);
  const remove = new Map<string, Change>();
  const kept: Benefit[] = [];
  const statusOf = (confirmed: boolean) => (confirmed ? 'confirmed' : 'unconfirmed') as Benefit['status'];

  for (const b of existing) {
    const r = byId.get(b.id);
    const source = r && (validUrl(r.sourceUrl) ?? validUrl(r.benefit?.sourceUrl));
    if (!r) {
      kept.push(b);
    } else if (r.action === 'keep') {
      const next: Benefit = r.confirmed
        ? { ...b, status: 'confirmed', verifiedAt: today, sourceUrl: b.sourceUrl ?? source }
        : { ...b, status: 'unconfirmed' };
      noteChange(result, b, next, { id: b.id, title: b.title, reason: 'status', detail: r.reason });
      kept.push(next);
    } else if (!source) {
      result.ignored.push(`${b.id}: ${r.action} without a source`);
      kept.push(b);
    } else if (r.action === 'remove') {
      remove.set(b.id, { id: b.id, title: b.title, reason: 'removed', detail: r.reason });
      kept.push(b);
    } else {
      const verifiedAt = r.confirmed ? today : b.verifiedAt;
      const converted = r.benefit
        ? toBenefit(r.benefit, { id: b.id, status: statusOf(r.confirmed), verifiedAt })
        : ({ ok: false, error: 'update without a benefit' } as const);
      if (!converted.ok) {
        result.ignored.push(`${b.id}: ${converted.error}`);
        kept.push(b);
        continue;
      }
      const next = { ...converted.value, sourceUrl: converted.value.sourceUrl ?? source };
      noteChange(result, b, next, { id: b.id, title: next.title, reason: 'updated', detail: r.reason });
      kept.push(next);
    }
  }
  result.items = guardRemovals(kept, remove, result);

  const taken = new Set(existing.map((b) => b.id));
  for (const r of reviews) {
    if (r.action !== 'add') continue;
    const source = validUrl(r.sourceUrl) ?? validUrl(r.benefit?.sourceUrl);
    if (!r.benefit || !source) {
      result.ignored.push(`add "${r.benefit?.title ?? r.reason}": no source`);
      continue;
    }
    const { card, title } = r.benefit;
    const tokens = titleTokens(title);
    const listed = result.items.some(
      (b) => b.card === card && jaccard(titleTokens(b.title), tokens) >= DUPLICATE_JACCARD,
    );
    if (listed) {
      result.ignored.push(`add "${title}": already listed`);
      continue;
    }
    const id = uniqueId(slugify(`${card} ${title}`, 50), taken);
    const verifiedAt = r.confirmed ? today : undefined;
    const converted = toBenefit(r.benefit, { id, status: statusOf(r.confirmed), verifiedAt });
    if (!converted.ok) {
      result.ignored.push(`add "${title}": ${converted.error}`);
      continue;
    }
    result.items.push({ ...converted.value, sourceUrl: converted.value.sourceUrl ?? source });
    result.changes.push({ id, title, reason: 'added', detail: r.reason });
  }
  return result;
}

/** Same rules as applyBenefitReviews; cards have no status, so keep changes nothing. */
export function applyCardReviews(existing: CardInfo[], reviews: CardReview[]): ReviewResult<CardInfo> {
  const result: ReviewResult<CardInfo> = { items: [], changes: [], ignored: [] };
  const byId = reviewsById(reviews);
  const remove = new Map<string, Change>();
  const kept: CardInfo[] = [];

  for (const c of existing) {
    const r = byId.get(c.id);
    const source = r && (validUrl(r.sourceUrl) ?? validUrl(r.info?.sourceUrl));
    if (!r || r.action === 'keep') {
      kept.push(c);
    } else if (!source) {
      result.ignored.push(`${c.id}: ${r.action} without a source`);
      kept.push(c);
    } else if (r.action === 'remove') {
      remove.set(c.id, { id: c.id, title: c.name, reason: 'removed', detail: r.reason });
      kept.push(c);
    } else {
      const converted = r.info
        ? toCardInfo(r.info, c.id)
        : ({ ok: false, error: 'update without card info' } as const);
      if (!converted.ok) {
        result.ignored.push(`${c.id}: ${converted.error}`);
        kept.push(c);
        continue;
      }
      const next = { ...converted.value, sourceUrl: converted.value.sourceUrl ?? source };
      noteChange(result, c, next, { id: c.id, title: next.name, reason: 'updated', detail: r.reason });
      kept.push(next);
    }
  }
  result.items = guardRemovals(kept, remove, result);

  const taken = new Set(existing.map((c) => c.id));
  for (const r of reviews) {
    if (r.action !== 'add') continue;
    const source = validUrl(r.sourceUrl) ?? validUrl(r.info?.sourceUrl);
    if (!r.info || !source) {
      result.ignored.push(`add "${r.info?.name ?? r.reason}": no source`);
      continue;
    }
    const name = r.info.name;
    if (result.items.some((c) => dedupeKey(c.name) === dedupeKey(name))) {
      result.ignored.push(`add "${name}": already listed`);
      continue;
    }
    const converted = toCardInfo(r.info, uniqueId(slugify(name, 40), taken));
    if (!converted.ok) {
      result.ignored.push(`add "${name}": ${converted.error}`);
      continue;
    }
    result.items.push({ ...converted.value, sourceUrl: converted.value.sourceUrl ?? source });
    result.changes.push({ id: converted.value.id, title: name, reason: 'added', detail: r.reason });
  }
  return result;
}
