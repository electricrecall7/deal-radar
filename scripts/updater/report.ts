// data/last-run.json and the console summary at the end of a run.
import type { Deal } from '../../src/lib/schema';
import type { UsageTotals } from './claude';
import { SEARCH_COST_PER_1000 } from './config';
import type { Change } from './merge';

export interface Failure {
  step: 'verify' | 'discover' | 'skeptic' | 'benefits';
  label: string;
  reason: string;
}

export interface AddedDeal {
  id: string;
  restaurant: string;
  title: string;
  start: string;
  end?: string;
  status: Deal['status'];
  angle: string;
  sourceUrl?: string;
}

export interface RunSummary {
  ranAt: string;
  today: string;
  /** api: billed to an API key; claude-code: the Claude Code CLI on the person's own Claude plan. */
  engine: 'api' | 'claude-code';
  /** Why the run stopped early, if it did (e.g. a Claude plan usage limit). */
  notice?: string;
  model: string;
  effort: string;
  durationMinutes: number;
  options: Record<string, unknown>;
  counts: {
    dealsBefore: number;
    dealsAfter: number;
    invalidEntriesDropped: number;
    ended: number;
    /** Deals picked for verification this run. */
    verifyDue: number;
    /** Deals skipped because they were checked in the last few days. */
    verifySkippedFresh: number;
    verified: number;
    reconfirmed: number;
    updated: number;
    removed: number;
    /** Existing deals removed as a copy of another existing deal. */
    duplicatesRemoved: number;
    candidates: number;
    duplicates: number;
    rejected: number;
    added: number;
    benefitsChanged: number;
    cardsChanged: number;
    requestsSucceeded: number;
    requestsFailed: number;
    requestsDeferred: number;
  };
  added: AddedDeal[];
  updated: Change[];
  removed: Change[];
  rejected: Change[];
  duplicates: Change[];
  benefits: { changes: Change[]; ignored: string[] };
  cards: { changes: Change[]; ignored: string[] };
  /** Verdicts or reviews that could not be applied as given. */
  problems: string[];
  failures: Failure[];
  /** Requests not sent, or cut off, because the time budget ran out; their deals go first next run. */
  deferred: string[];
  discoveryNotes: { angle: string; notes: string }[];
  usage: UsageTotals & { estimatedSearchCostUsd: number };
}

export function searchCost(searches: number): number {
  return Math.round(searches * SEARCH_COST_PER_1000) / 1000;
}

const label = (c: Change) => `${c.restaurant ? `${c.restaurant}: ` : ''}${c.title}`;
const why = (c: Change) => `${label(c)}: ${c.reason}${c.detail ? `, ${c.detail}` : ''}`;
const fieldsOf = (c: Change) => `${label(c)} (${c.fields?.join(', ') || c.reason})`;
const span = (a: AddedDeal) => `${a.start}..${a.end ?? ''}`;

function section(title: string, lines: string[], limit = 25): string[] {
  if (lines.length === 0) return [];
  const shown = lines.slice(0, limit).map((l) => `  ${l}`);
  if (lines.length > limit) shown.push(`  ...and ${lines.length - limit} more (see data/last-run.json)`);
  return ['', `${title} (${lines.length})`, ...shown];
}

export function formatSummary(s: RunSummary): string {
  const c = s.counts;
  const u = s.usage;
  const plan = s.engine === 'claude-code';
  const cost = plan ? '' : ` (~$${u.estimatedSearchCostUsd.toFixed(2)})`;
  const floor = u.incompleteRequests ? ` (${u.incompleteRequests} cut short, so usage is a floor)` : '';
  const how = plan ? `Claude Code on your Claude plan, model ${s.model}` : `${s.model}, effort ${s.effort}`;
  return [
    `Deal update for ${s.today}: ${c.dealsBefore} -> ${c.dealsAfter} deals in ${s.durationMinutes} min (${how})`,
    ...(s.notice ? [`  STOPPED EARLY: ${s.notice}. The deals it didn't reach go first next time.`] : []),
    `  verified ${c.verified} of ${c.verifyDue} due (${c.reconfirmed} confirmed, ` +
      `${c.verifySkippedFresh} checked recently), updated ${c.updated}, ` +
      `removed ${c.removed} + ${c.ended} ended + ${c.duplicatesRemoved} duplicates`,
    `  new finds ${c.candidates}: ${c.added} added, ${c.duplicates} duplicates, ${c.rejected} rejected`,
    `  benefits changed ${c.benefitsChanged}, cards changed ${c.cardsChanged}`,
    `  requests ${c.requestsSucceeded} ok / ${c.requestsFailed} failed / ${c.requestsDeferred} deferred; ` +
      `${plan ? 'Claude Code runs' : 'API calls'} ${u.requests}${floor}, ` +
      `tokens ${u.inputTokens} in (+${u.cacheReadTokens} cached) / ${u.outputTokens} out, ` +
      `${u.webSearches} searches${cost}, ${u.webFetches} fetches`,
    ...section(
      'Added',
      s.added.map((a) => `${a.restaurant}: ${a.title} [${span(a)}] ${a.status}, ${a.angle}`),
    ),
    ...section('Updated', s.updated.map(fieldsOf)),
    ...section('Removed', s.removed.map(why)),
    ...section('Rejected new finds', s.rejected.map(why)),
    ...section('Benefits and cards', [...s.benefits.changes, ...s.cards.changes].map(fieldsOf)),
    ...section('Not applied', [...s.problems, ...s.benefits.ignored, ...s.cards.ignored]),
    ...section('Failed requests', s.failures.map((f) => `${f.label}: ${f.reason}`)),
    ...section(s.notice ? 'Deferred to the next run' : 'Deferred to the next run (time budget)', s.deferred),
  ].join('\n');
}
