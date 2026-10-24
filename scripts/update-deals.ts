// Weekly deal update, run by .github/workflows/weekly-deals.yml:
//   1 prune ended deals   2 re-verify active ones   3 search for new ones by angle, plus a
//   promo-code sweep of data/code-watchlist.json   4 drop duplicates   5 skeptic pass on new finds
//   6 re-check card benefits   7 drop duplicate copies already in the file
// then write data/deals.json and data/last-run.json. `--help` lists the flags.
import fs from 'node:fs';
import path from 'node:path';

import { parseDealsFile, type Deal, type DealsFile } from '../src/lib/schema';
import { isHeldBenefit, isHeldCard } from '../src/lib/wallet';
import { createResearcher, type Outcome, type Researcher, type SubmitRequest } from './updater/claude';
import { checkClaudeCodePlan, createClaudeCodeResearcher } from './updater/claude-code';
import { buildCodeWatchlist, CODES_ANGLE, promoCodeAngles } from './updater/codes';
import {
  BENEFITS_FETCHES,
  BENEFITS_SEARCHES,
  DISCOVER_FETCHES,
  DISCOVER_SEARCHES,
  HARD_STOP_GRACE_MINUTES,
  MAX_CANDIDATES_PER_ANGLE,
  MAX_SKEPTIC_CANDIDATES,
  parseArgs,
  PRIORITY,
  SKEPTIC_RESERVE_MINUTES,
  USAGE,
  VERIFY_BATCH,
  VERIFY_FETCHES,
  VERIFY_FRESH_DAYS,
  VERIFY_SEARCHES,
  type Options,
} from './updater/config';
import { invalidEntries, toDeal } from './updater/convert';
import {
  applyBenefitReviews,
  applyCardReviews,
  applyVerdicts,
  assignIds,
  buildFile,
  chicagoToday,
  chunk,
  cmp,
  dedupeCandidates,
  dedupeExisting,
  pickForVerify,
  pruneEnded,
  serializeFile,
  type Change,
} from './updater/merge';
import {
  ANGLES,
  angleByName,
  benefitsContent,
  discoverContent,
  skepticContent,
  verifyContent,
  type Angle,
} from './updater/prompts';
import { formatSummary, searchCost, type AddedDeal, type Failure, type RunSummary } from './updater/report';
import {
  SubmitBenefitsZ,
  SubmitDealsZ,
  SubmitVerdictsZ,
  submitBenefitsTool,
  submitDealsTool,
  submitVerdictsTool,
  type SubmitBenefits,
  type SubmitDeals,
  type SubmitVerdicts,
  type Verdict,
} from './updater/tools';

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DEAL_DATA_DIR ? path.resolve(process.env.DEAL_DATA_DIR) : path.join(ROOT, 'data');
const DEALS_PATH = path.join(DATA_DIR, 'deals.json');
const LAST_RUN_PATH = path.join(DATA_DIR, 'last-run.json');
const WATCHLIST_PATH = path.join(DATA_DIR, 'code-watchlist.json');

function readWatchlist(): string[] {
  if (!fs.existsSync(WATCHLIST_PATH)) return [];
  const raw = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8')) as { restaurants?: unknown };
  return Array.isArray(raw.restaurants) ? raw.restaurants.filter((r): r is string => typeof r === 'string') : [];
}

const log = (line: string) => console.log(line);

interface Context {
  today: string;
  researcher: Researcher;
  succeeded: number;
  failures: Failure[];
  /** Requests never sent, or cut off, because the time budget ran out. */
  deferred: string[];
}

async function ask<T>(
  ctx: Context,
  step: Failure['step'],
  request: Omit<SubmitRequest<T>, 'priority'>,
): Promise<Outcome<T>> {
  const outcome = await ctx.researcher.submit({ ...request, priority: PRIORITY[step] });
  if (outcome.ok) ctx.succeeded++;
  else if (outcome.deferred) ctx.deferred.push(request.label);
  else ctx.failures.push({ step, label: request.label, reason: outcome.reason });
  return outcome;
}

const joinVerdicts = (a: SubmitVerdicts, b: SubmitVerdicts) => ({ verdicts: [...a.verdicts, ...b.verdicts] });

type Judged = { batch: Deal[]; verdicts: Verdict[] } | { batch: Deal[]; verdicts?: undefined; reason: string };

/** Asks for keep / update / remove verdicts on batches of deals; a failed batch comes back with a reason. */
function judge(ctx: Context, step: 'verify' | 'skeptic', deals: Deal[]): Promise<Judged[]> {
  const batches = chunk(deals, VERIFY_BATCH);
  return Promise.all(
    batches.map(async (batch, i): Promise<Judged> => {
      const outcome = await ask(ctx, step, {
        label: `${step} ${i + 1}/${batches.length}`,
        tool: submitVerdictsTool,
        schema: SubmitVerdictsZ,
        combine: joinVerdicts,
        searches: VERIFY_SEARCHES,
        fetches: VERIFY_FETCHES,
        content: step === 'verify' ? verifyContent(batch, ctx.today) : skepticContent(batch, ctx.today),
      });
      return outcome.ok ? { batch, verdicts: outcome.value.verdicts } : { batch, reason: outcome.reason };
    }),
  );
}

async function verifyDeals(ctx: Context, deals: Deal[]) {
  const replaced = new Map<string, Deal | null>();
  const updated: Change[] = [];
  const removed: Change[] = [];
  const removedDeals: Deal[] = [];
  const problems: string[] = [];
  let checked = 0;
  let reconfirmed = 0;
  for (const { batch, verdicts } of await judge(ctx, 'verify', deals)) {
    if (!verdicts) continue;
    const r = applyVerdicts(batch, verdicts, ctx.today);
    checked += batch.length - r.missing.length;
    reconfirmed += r.confirmed;
    updated.push(...r.updated);
    removed.push(...r.removed);
    problems.push(...r.problems, ...r.missing.map((id) => `${id}: no verdict; left unchanged`));
    for (const d of r.deals) replaced.set(d.id, d);
    for (const c of r.removed) {
      replaced.set(c.id, null);
      const original = batch.find((d) => d.id === c.id);
      if (original) removedDeals.push(original);
    }
  }
  return { replaced, updated, removed, removedDeals, problems, checked, reconfirmed };
}

interface Candidate {
  deal: Deal;
  angle: string;
}

const joinDeals = (a: SubmitDeals, b: SubmitDeals) => ({
  deals: [...a.deals, ...b.deals],
  notes: [a.notes, b.notes].filter(Boolean).join(' '),
});

async function discoverAngle(ctx: Context, angle: Angle, known: Deal[], signal: AbortSignal) {
  const candidates: Candidate[] = [];
  const rejected: Change[] = [];
  const outcome = await ask(ctx, 'discover', {
    label: `discover ${angle.name}`,
    tool: submitDealsTool,
    schema: SubmitDealsZ,
    combine: joinDeals,
    searches: angle.searches ?? DISCOVER_SEARCHES,
    fetches: angle.fetches ?? DISCOVER_FETCHES,
    content: discoverContent(angle, known, ctx.today),
    signal,
  });
  if (!outcome.ok) return { candidates, rejected, notes: '' };
  outcome.value.deals.forEach((t, i) => {
    const converted = toDeal(t, { id: `new-${angle.name}-${i + 1}` });
    const found = { id: '', restaurant: t.restaurant, title: t.title || '(untitled)' };
    if (!converted.ok) {
      rejected.push({ ...found, reason: 'invalid', detail: converted.error });
    } else if (converted.value.end && converted.value.end < ctx.today) {
      rejected.push({ ...found, reason: 'already over' });
    } else if (candidates.length >= MAX_CANDIDATES_PER_ANGLE) {
      rejected.push({ ...found, reason: 'over the per-angle cap' });
    } else {
      candidates.push({ deal: converted.value, angle: angle.name });
    }
  });
  return { candidates, rejected, notes: outcome.value.notes.trim() };
}

/**
 * Runs every angle until `cutoff`. Angles still running then are cut off and come back deferred, so one
 * slow angle can't hold up the skeptic pass for all the others.
 */
async function discover(ctx: Context, angles: Angle[], known: Deal[], cutoff: number) {
  const stop = new AbortController();
  const all = Promise.all(angles.map((angle) => discoverAngle(ctx, angle, known, stop.signal)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), Math.max(0, cutoff - Date.now()));
  });
  if ((await Promise.race([all, late])) === 'late') {
    log('Discovery cutoff: cutting off the angles still running so the skeptic pass has time.');
    stop.abort();
  }
  clearTimeout(timer);
  // Cut-off angles settle right after the abort. One result per angle, flattened in angle order so the
  // output doesn't depend on which finished first.
  const perAngle = await all;
  return {
    candidates: perAngle.flatMap((r) => r.candidates),
    rejected: perAngle.flatMap((r) => r.rejected),
    notes: perAngle.flatMap((r, i) => (r.notes ? [{ angle: angles[i].name, notes: r.notes }] : [])),
  };
}

/** New finds survive only if a skeptic pass looked at them and didn't refute them. */
async function doubleCheck(ctx: Context, candidates: Deal[]) {
  const survivors: Deal[] = [];
  const rejected: Change[] = [];
  const problems: string[] = [];
  for (const result of await judge(ctx, 'skeptic', candidates)) {
    const { batch } = result;
    if (!result.verdicts) {
      rejected.push(...batch.map((d) => asChange(d, 'not double-checked', result.reason)));
      continue;
    }
    const r = applyVerdicts(batch, result.verdicts, ctx.today);
    rejected.push(...r.removed);
    problems.push(...r.problems);
    for (const d of r.deals) {
      if (r.missing.includes(d.id)) rejected.push(asChange(d, 'not double-checked', 'no verdict'));
      else survivors.push(d);
    }
  }
  return { survivors, rejected, problems };
}

function asChange(d: Deal, reason: string, detail?: string): Change {
  return { id: d.id, restaurant: d.restaurant, title: d.title, reason, detail };
}

async function reviewBenefits(ctx: Context, file: DealsFile) {
  const outcome = await ask<SubmitBenefits>(ctx, 'benefits', {
    label: 'benefits',
    tool: submitBenefitsTool,
    schema: SubmitBenefitsZ,
    combine: (a, b) => ({ benefits: [...a.benefits, ...b.benefits], cards: [...a.cards, ...b.cards] }),
    searches: BENEFITS_SEARCHES,
    fetches: BENEFITS_FETCHES,
    content: benefitsContent(file.benefits, file.cards, ctx.today),
  });
  if (!outcome.ok) return undefined;
  return {
    benefits: applyBenefitReviews(file.benefits, outcome.value.benefits, ctx.today),
    cards: applyCardReviews(file.cards, outcome.value.cards),
  };
}

/** The regular angles to run, and whether --angles asked for the promo-code sweep. */
function selectAngles(names: string[] | undefined): { angles: Angle[]; codes: boolean } {
  if (!names) return { angles: ANGLES, codes: true };
  const unknown = names.filter((n) => n !== CODES_ANGLE && !angleByName(n));
  if (unknown.length > 0) {
    const all = [...ANGLES.map((a) => a.name), CODES_ANGLE].join(', ');
    throw new Error(`Unknown angle ${unknown.join(', ')}. Angles: ${all}`);
  }
  return { angles: ANGLES.filter((a) => names.includes(a.name)), codes: names.includes(CODES_ANGLE) };
}

function planAngles(opts: Options, deals: Deal[]): { angles: Angle[]; watchlist: string[] } {
  if (opts.skipDiscover) return { angles: [], watchlist: [] };
  const picked = selectAngles(opts.angles);
  const regular = opts.codes === 'only' ? [] : picked.angles;
  const wantCodes = opts.codes === 'only' || (opts.codes === 'include' && picked.codes);
  const watchlist = wantCodes ? buildCodeWatchlist(readWatchlist(), deals) : [];
  return { angles: [...regular, ...promoCodeAngles(watchlist)], watchlist };
}

interface Plan {
  opts: Options;
  file: DealsFile;
  dropped: number;
  kept: Deal[];
  ended: Change[];
  toVerify: Deal[];
  fresh: number;
  angles: Angle[];
  watchlist: string[];
  today: string;
}

/** Minutes into the run when discovery stops, so the skeptic pass has time to check what it found. */
const discoveryMinutes = (budget: number) => budget - Math.min(SKEPTIC_RESERVE_MINUTES, budget / 2);

/** Rewriting deals.json would delete entries that fail the schema, so say which ones and why. */
function reportInvalid(raw: unknown, dropped: number, dryRun: boolean): void {
  const out = dryRun ? log : (line: string) => console.error(line);
  out(`${DEALS_PATH} has ${dropped} ${dropped === 1 ? 'entry' : 'entries'} that fail the schema:`);
  for (const line of invalidEntries(raw)) out(`  ${line}`);
  out(
    dryRun
      ? 'A real run stops here, before any API call, until they are fixed or removed.'
      : 'Stopped before any API call and wrote nothing, since rewriting the file would delete them. ' +
          'Fix or remove them by hand, then run again.',
  );
}

/** Prints what a real run would do and what it could cost, without calling the API or writing. */
function dryRun({ opts, file, dropped, kept, ended, toVerify, fresh, angles, watchlist, today }: Plan): number {
  const verifyBatches = Math.ceil(toVerify.length / VERIFY_BATCH);
  const skepticBatches = angles.length > 0 ? Math.ceil(MAX_SKEPTIC_CANDIDATES / VERIFY_BATCH) : 0;
  const benefits = opts.skipBenefits ? 0 : 1;
  const judged = verifyBatches + skepticBatches;
  const angleSearches = angles.reduce((n, a) => n + (a.searches ?? DISCOVER_SEARCHES), 0);
  const angleFetches = angles.reduce((n, a) => n + (a.fetches ?? DISCOVER_FETCHES), 0);
  const searches = judged * VERIFY_SEARCHES + angleSearches + benefits * BENEFITS_SEARCHES;
  const fetches = judged * VERIFY_FETCHES + angleFetches + benefits * BENEFITS_FETCHES;
  const requests = judged + angles.length + benefits;

  log(`Dry run for ${today}: no API calls, nothing written.`);
  log(
    `Loaded ${file.deals.length} deals, ${file.benefits.length} benefits, ${file.cards.length} cards, ` +
      `${file.resources.length} resources (${dropped} invalid entries dropped).`,
  );
  log(`Would remove ${ended.length} ended deals${ended.length ? ':' : '.'}`);
  for (const c of ended) log(`  ${c.restaurant}: ${c.title} (${c.detail})`);
  const copies = dedupeExisting(kept).removed;
  log(`Would remove ${copies.length} duplicate copies${copies.length ? ':' : '.'}`);
  for (const c of copies) log(`  ${c.restaurant}: ${c.title} (${c.detail})`);
  log(
    `Would verify ${toVerify.length} of ${kept.length} deals in ${verifyBatches} batches` +
      (fresh ? ` (${fresh} were checked in the last ${VERIFY_FRESH_DAYS} days).` : '.'),
  );
  if (watchlist.length > 0) {
    const batches = angles.filter((a) => a.name.startsWith(CODES_ANGLE)).length;
    log(`Would search promo codes for ${watchlist.length} restaurants in ${batches} requests.`);
  }
  if (angles.length > 0) {
    log(`Would run ${angles.length} discovery angles: ${angles.map((a) => a.name).join(', ')}.`);
    log(`Angles still running at minute ${discoveryMinutes(opts.budgetMinutes)} would be cut off.`);
    log(`Would double-check up to ${MAX_SKEPTIC_CANDIDATES} new finds in up to ${skepticBatches} batches.`);
  } else {
    log('Would skip discovery.');
  }
  if (benefits) log(`Would re-check ${file.benefits.length} benefits and ${file.cards.length} cards.`);
  else log('Would skip benefits.');
  if (opts.engine === 'claude-code') {
    const plan = checkClaudeCodePlan();
    log(
      `Budget: up to ${requests} Claude Code runs on your Claude plan (model ${opts.model}), about ${searches} ` +
        `searches and ${fetches} fetches. No API bill; your plan's usage limits apply.`,
    );
    log(plan.ok ? `Claude Code is signed in with your plan (${plan.method}).` : `Claude Code isn't ready: ${plan.problem}.`);
  } else {
    const cost = searchCost(searches).toFixed(2);
    log(
      `Budget: up to ${requests} requests (${opts.model}, effort ${opts.effort}), ` +
        `up to ${searches} web searches (~$${cost}) and ${fetches} fetches, plus tokens.`,
    );
  }
  log(
    `Verification gets whatever is left of the ${opts.budgetMinutes}-minute budget after discovery; ` +
      'deals it does not reach go first next run.',
  );
  const pruned = buildFile(file, { deals: kept, benefits: file.benefits, cards: file.cards }, new Date());
  log(`The pruned file is valid (${pruned.deals.length} deals).`);
  if (opts.engine === 'api' && !process.env.ANTHROPIC_API_KEY) {
    log('Note: ANTHROPIC_API_KEY is not set; a real API run needs it.');
  }
  return 0;
}

async function main(): Promise<number> {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2), process.env);
    selectAngles(opts.angles);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    return 2;
  }
  if (opts.help) {
    log(USAGE);
    return 0;
  }

  const startedAt = Date.now();
  const today = chicagoToday();
  const raw: unknown = JSON.parse(fs.readFileSync(DEALS_PATH, 'utf8'));
  const { file, dropped } = parseDealsFile(raw);
  if (dropped > 0) {
    reportInvalid(raw, dropped, opts.dryRun);
    if (!opts.dryRun) return 1;
  }
  const { kept, removed: ended } = pruneEnded(file.deals, today);
  const { angles, watchlist } = planAngles(opts, kept);
  const picked = opts.skipVerify ? { due: [], fresh: 0 } : pickForVerify(kept, today, opts.limit);
  const { due: toVerify, fresh } = picked;
  if (opts.dryRun) return dryRun({ opts, file, dropped, kept, ended, toVerify, fresh, angles, watchlist, today });

  const needsApi = toVerify.length > 0 || angles.length > 0 || !opts.skipBenefits;
  if (needsApi && opts.engine === 'claude-code') {
    const plan = checkClaudeCodePlan();
    if (!plan.ok) {
      const fix = {
        'not-installed':
          "Claude Code isn't installed (or isn't on PATH). Install it in PowerShell with " +
          '"irm https://claude.ai/install.ps1 | iex", then run "claude" once and sign in with your Claude plan.',
        'signed-out': 'Claude Code is not signed in. Run "claude" (or "claude auth login") and sign in with your Claude plan.',
        'api-billing':
          `Claude Code is set to bill something other than your Claude plan (${plan.detail}). Run "claude auth ` +
          'login" and pick your Claude subscription, and remove any API key, apiKeyHelper or cloud-provider ' +
          'setting from ~/.claude/settings.json. Nothing was searched.',
        'unknown-login':
          `Couldn't tell how Claude Code is signed in ("claude auth status" said: ${plan.detail}). Update Claude ` +
          'Code and try again. Nothing was searched, to make sure no API key gets billed.',
      }[plan.problem];
      console.error(fix);
      return 1;
    }
    log(`Claude Code is signed in (${plan.method}).`);
  }
  if (needsApi && opts.engine === 'api' && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error(
      'ANTHROPIC_API_KEY is not set. Export a Claude API key (for the workflow, add it as a repository ' +
        'secret), or pass --dry-run to preview without API calls.',
    );
    return 1;
  }

  const engineLine = opts.engine === 'claude-code' ? 'Claude Code on this PC (your Claude plan)' : 'the Claude API';
  log(`Deal update for ${today} via ${engineLine}, model ${opts.model}${opts.engine === 'api' ? ` (effort ${opts.effort})` : ''}.`);
  log(`${file.deals.length} deals loaded, ${ended.length} ended.`);
  const softDeadline = startedAt + opts.budgetMinutes * 60_000;
  const discoveryCutoff = startedAt + discoveryMinutes(opts.budgetMinutes) * 60_000;
  const ctx: Context = {
    today,
    succeeded: 0,
    failures: [],
    deferred: [],
    researcher: (opts.engine === 'claude-code' ? createClaudeCodeResearcher : createResearcher)({
      model: opts.model,
      effort: opts.effort,
      softDeadline,
      hardDeadline: startedAt + (opts.budgetMinutes + HARD_STOP_GRACE_MINUTES) * 60_000,
      log,
    }),
  };

  // Everything is queued up front and the shared gate keeps three requests in flight. Free slots go to
  // whoever asks first and waiting requests go by PRIORITY, so discovery is asked first.
  const discoverRun = discover(ctx, angles, kept, discoveryCutoff);
  const benefitsRun = opts.skipBenefits ? Promise.resolve(undefined) : reviewBenefits(ctx, file);
  const verifyRun = verifyDeals(ctx, toVerify);

  // Dedupe against the pre-verify list so the skeptic pass can start without waiting for verify.
  const found = await discoverRun;
  const firstPass = dedupeCandidates(found.candidates.map((c) => c.deal), kept);
  // Over the cap, the soonest deals matter most.
  const overCap = [...firstPass.unique]
    .sort((a, b) => cmp(a.start, b.start) || cmp(a.id, b.id))
    .slice(MAX_SKEPTIC_CANDIDATES);
  const toCheck = firstPass.unique.filter((d) => !overCap.includes(d));
  const checkRun = doubleCheck(ctx, toCheck);

  const verified = await verifyRun;
  const checked = await checkRun;
  const reviewed = await benefitsRun;

  const existing = kept.flatMap((d) => {
    const next = verified.replaced.get(d.id);
    return next === undefined ? [d] : next === null ? [] : [next];
  });
  // Copies the older, stricter duplicate check let in, or that verification just made identical.
  const cleaned = dedupeExisting(existing);
  // Verification may have moved dates, so check again against the final list and anything removed today.
  const secondPass = dedupeCandidates(checked.survivors, [...existing, ...verified.removedDeals]);
  const angleOf = new Map(found.candidates.map((c) => [c.deal.id, c.angle]));
  // Ids of removed copies stay taken, so a new deal never inherits prefs set on one.
  const newDeals = assignIds(secondPass.unique, existing, today);
  const added: AddedDeal[] = newDeals.map((d, i) => ({
    id: d.id,
    restaurant: d.restaurant,
    title: d.title,
    start: d.start,
    end: d.end,
    status: d.status,
    angle: angleOf.get(secondPass.unique[i].id) ?? '',
    sourceUrl: d.sourceUrl,
  }));

  const next = buildFile(
    file,
    {
      deals: [...cleaned.kept, ...newDeals],
      // Only the user's own cards (src/lib/wallet.ts), whatever the review added.
      benefits: (reviewed?.benefits.items ?? file.benefits).filter(isHeldBenefit),
      cards: (reviewed?.cards.items ?? file.cards).filter(isHeldCard),
    },
    new Date(),
  );

  const attempted = ctx.succeeded + ctx.failures.length;
  const usage = ctx.researcher.usage;
  const rejected = [
    ...found.rejected,
    ...overCap.map((d) => asChange(d, 'over the skeptic-pass cap')),
    ...checked.rejected,
  ];
  const summary: RunSummary = {
    ranAt: new Date().toISOString(),
    today,
    engine: opts.engine,
    ...(ctx.researcher.notice ? { notice: ctx.researcher.notice } : {}),
    model: opts.model,
    effort: opts.effort,
    durationMinutes: Math.round((Date.now() - startedAt) / 6_000) / 10,
    options: {
      skipVerify: opts.skipVerify,
      skipDiscover: opts.skipDiscover,
      skipBenefits: opts.skipBenefits,
      angles: angles.map((a) => a.name),
      limit: opts.limit ?? null,
      budgetMinutes: opts.budgetMinutes,
    },
    counts: {
      dealsBefore: file.deals.length,
      dealsAfter: next.deals.length,
      invalidEntriesDropped: dropped,
      ended: ended.length,
      verifyDue: toVerify.length,
      verifySkippedFresh: fresh,
      verified: verified.checked,
      reconfirmed: verified.reconfirmed,
      updated: verified.updated.length,
      removed: verified.removed.length,
      duplicatesRemoved: cleaned.removed.length,
      candidates: found.candidates.length + found.rejected.length,
      duplicates: firstPass.duplicates.length + secondPass.duplicates.length,
      rejected: rejected.length,
      added: newDeals.length,
      benefitsChanged: reviewed?.benefits.changes.length ?? 0,
      cardsChanged: reviewed?.cards.changes.length ?? 0,
      requestsSucceeded: ctx.succeeded,
      requestsFailed: ctx.failures.length,
      requestsDeferred: ctx.deferred.length,
    },
    added,
    updated: verified.updated,
    removed: [...ended, ...verified.removed, ...cleaned.removed],
    rejected,
    duplicates: [...firstPass.duplicates, ...secondPass.duplicates],
    benefits: { changes: reviewed?.benefits.changes ?? [], ignored: reviewed?.benefits.ignored ?? [] },
    cards: { changes: reviewed?.cards.changes ?? [], ignored: reviewed?.cards.ignored ?? [] },
    problems: [...verified.problems, ...checked.problems],
    failures: ctx.failures,
    deferred: ctx.deferred,
    discoveryNotes: found.notes,
    usage: { ...usage, estimatedSearchCostUsd: searchCost(usage.webSearches) },
  };

  fs.writeFileSync(DEALS_PATH, serializeFile(next));
  fs.writeFileSync(LAST_RUN_PATH, serializeFile(summary));
  log('');
  log(formatSummary(summary));
  log(`\nWrote ${DEALS_PATH} and ${LAST_RUN_PATH}.`);

  if (attempted > 0 && ctx.succeeded === 0) {
    console.error('Every request failed, so nothing was verified or found. See the failures above.');
    return 1;
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  },
);

