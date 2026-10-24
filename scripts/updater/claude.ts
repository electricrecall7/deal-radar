// One research request: web search + web fetch on Anthropic's side, ending in a call to one of our
// submit tools. Handles pause_turn, nudges when the model forgets to submit, one wall-clock deadline per
// request, and keeps usage totals (including what aborted streams had used).
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';

import {
  CONCURRENCY,
  MAX_CONTINUATIONS,
  MAX_NUDGES,
  MAX_RESEARCH_MINUTES,
  MAX_TOKENS,
  REQUEST_TIMEOUT_MS,
  SA_LOCATION,
  SDK_MAX_RETRIES,
  type Effort,
} from './config';
import { NUDGE, SYSTEM_PROMPT } from './prompts';

type Message = Anthropic.Beta.BetaMessage;
type MessageParam = Anthropic.Beta.BetaMessageParam;

export interface UsageTotals {
  /** API calls that sent back a message, whole or partial. */
  requests: number;
  /**
   * Calls that ended without a final message (aborted, timed out or dropped mid-stream). Only the usage
   * that had arrived is counted for them, so when this is above 0 every total here is a floor.
   */
  incompleteRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  webFetches: number;
}

export function emptyUsage(): UsageTotals {
  return {
    requests: 0,
    incompleteRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
    webFetches: 0,
  };
}

export function addUsage(
  totals: UsageTotals,
  usage: Anthropic.Beta.BetaUsage,
  tools: Anthropic.Beta.BetaServerToolUsage | null = usage.server_tool_use,
): void {
  totals.requests++;
  totals.inputTokens += usage.input_tokens;
  totals.outputTokens += usage.output_tokens;
  totals.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  totals.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
  totals.webSearches += tools?.web_search_requests ?? 0;
  totals.webFetches += tools?.web_fetch_requests ?? 0;
}

/**
 * Usage of a stream that never finished, from the snapshot it had built. Server tool counts only arrive
 * with message_delta, so until then the web_search / web_fetch calls in its content are counted instead.
 */
export function addPartialUsage(totals: UsageTotals, partial: Message): void {
  totals.incompleteRequests++;
  if (partial.stop_reason) {
    addUsage(totals, partial.usage);
    return;
  }
  const calls = (name: string) =>
    partial.content.filter((b) => b.type === 'server_tool_use' && b.name === name).length;
  const reported = partial.usage.server_tool_use;
  addUsage(totals, partial.usage, {
    web_search_requests: Math.max(reported?.web_search_requests ?? 0, calls('web_search')),
    web_fetch_requests: Math.max(reported?.web_fetch_requests ?? 0, calls('web_fetch')),
  });
}

export interface SubmitRequest<T> {
  /** For logs, e.g. "verify 2/14". */
  label: string;
  tool: Anthropic.Beta.BetaTool;
  schema: z.ZodType<T>;
  /** Folds several calls of the submit tool in one turn into one result. */
  combine: (a: T, b: T) => T;
  searches: number;
  fetches: number;
  /** Lower starts first when requests are waiting for a slot. */
  priority: number;
  content: Anthropic.Beta.BetaContentBlockParam[];
  /** Aborting it cuts the request off, or keeps it from starting; it then comes back deferred. */
  signal?: AbortSignal;
}

/** deferred: never sent, or cut off, because the time budget ran out (not an error). */
export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string; deferred?: boolean };

export interface Researcher {
  usage: UsageTotals;
  /** Why the run stopped early, e.g. a Claude plan usage limit; shown in the summary. */
  notice?: string;
  submit<T>(request: SubmitRequest<T>): Promise<Outcome<T>>;
}

export interface ResearcherOptions {
  model: string;
  effort: Effort;
  /** No request starts after this time (ms since epoch). */
  softDeadline: number;
  /** Requests still running at this time are aborted. */
  hardDeadline: number;
  log: (line: string) => void;
}

/** Keeps at most `limit` tasks running. Waiting tasks start lowest priority first, then in call order. */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: { priority: number; start: () => void }[] = [];
  return async function run<T>(task: () => Promise<T>, priority = 0): Promise<T> {
    if (active < limit) active++;
    else await new Promise<void>((start) => waiting.push({ priority, start }));
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next waiter so a newcomer can't slip in between.
      let best = 0;
      for (let i = 1; i < waiting.length; i++) if (waiting[i].priority < waiting[best].priority) best = i;
      const next = waiting.splice(best, 1)[0];
      if (next) next.start();
      else active--;
    }
  };
}

const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;

function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIUserAbortError) return 'aborted at the time limit';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'request timed out';
  if (err instanceof Anthropic.APIError) {
    return `API error ${err.status ?? ''}: ${err.message}`.replace(/\s+/g, ' ');
  }
  return err instanceof Error ? err.message : String(err);
}

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
}

export function createResearcher(opts: ResearcherOptions): Researcher {
  const client = new Anthropic({ maxRetries: SDK_MAX_RETRIES });
  const usage = emptyUsage();
  const gate = createLimiter(CONCURRENCY);
  // A bad or unauthorized key fails every request the same way, so stop sending them.
  let fatal: string | undefined;
  const hardStop = AbortSignal.timeout(Math.max(1_000, opts.hardDeadline - Date.now()));

  async function stream(
    request: SubmitRequest<unknown>,
    messages: MessageParam[],
    signal: AbortSignal,
  ): Promise<Message> {
    const handle = client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: opts.effort },
        // Caches the growing conversation for pause_turn continuations; the system block below and
        // the shared discovery block carry their own breakpoints.
        cache_control: { type: 'ephemeral' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: request.searches,
            user_location: SA_LOCATION,
          },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: request.fetches },
          request.tool,
        ],
        messages,
      },
      { signal, timeout: REQUEST_TIMEOUT_MS },
    );
    let message: Message | undefined;
    try {
      message = await handle.finalMessage();
      return message;
    } finally {
      // An aborted or broken stream is still billed for what it did, so count whatever arrived.
      if (message) addUsage(usage, message.usage);
      else if (handle.currentMessage) addPartialUsage(usage, handle.currentMessage);
    }
  }

  async function research<T>(request: SubmitRequest<T>): Promise<Outcome<T>> {
    const started = Date.now();
    // One deadline for the whole request, every continuation and nudge included.
    const deadline = Math.min(opts.hardDeadline, started + MAX_RESEARCH_MINUTES * 60_000);
    const signal = AbortSignal.any([
      hardStop,
      AbortSignal.timeout(Math.max(1_000, deadline - started)),
      ...(request.signal ? [request.signal] : []),
    ]);
    const tag = `[${request.label}]`;
    const limit =
      deadline === opts.hardDeadline ? 'the time limit' : `the ${MAX_RESEARCH_MINUTES}-minute request limit`;
    const stopped = (): Outcome<T> => {
      if (!request.signal?.aborted) return { ok: false, reason: `stopped at ${limit}` };
      opts.log(`${tag} cut off`);
      return { ok: false, reason: 'cut off before it finished', deferred: true };
    };
    const messages: MessageParam[] = [{ role: 'user', content: request.content }];
    let continuations = 0;
    let nudges = 0;
    let searches = 0;
    let fetches = 0;

    while (true) {
      // Past the deadline a new continuation or nudge would only be aborted.
      if (signal.aborted || Date.now() >= deadline) return stopped();
      let message: Message;
      try {
        message = await stream(request as SubmitRequest<unknown>, messages, signal);
      } catch (err) {
        if (signal.aborted) return stopped();
        throw err;
      }
      searches += message.usage.server_tool_use?.web_search_requests ?? 0;
      fetches += message.usage.server_tool_use?.web_fetch_requests ?? 0;
      if (message.model !== opts.model) opts.log(`${tag} answered by fallback model ${message.model}`);

      switch (message.stop_reason) {
        case 'pause_turn':
          // The server paused a long web-research turn; sending it back resumes where it stopped.
          if (++continuations > MAX_CONTINUATIONS) return { ok: false, reason: 'paused too many times' };
          messages.push({ role: 'assistant', content: message.content });
          continue;
        case 'refusal': {
          const details = message.stop_details;
          const why = [details?.category, details?.explanation].filter(Boolean).join(': ');
          return { ok: false, reason: `declined by the model${why ? ` (${why})` : ''}` };
        }
        case 'max_tokens':
          return { ok: false, reason: `hit max_tokens (${MAX_TOKENS})` };
        case 'tool_use':
        case 'end_turn':
          break;
        default:
          return { ok: false, reason: `stopped with ${message.stop_reason}` };
      }

      const calls = message.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === request.tool.name,
      );
      let value: T | undefined;
      const problems: string[] = [];
      for (const call of calls) {
        const parsed = request.schema.safeParse(call.input);
        if (parsed.success) value = value === undefined ? parsed.data : request.combine(value, parsed.data);
        else problems.push(issues(parsed.error));
      }
      if (value !== undefined) {
        const took = minutes(Date.now() - started);
        opts.log(`${tag} done in ${took}: ${searches} searches, ${fetches} fetches`);
        return { ok: true, value };
      }

      if (nudges++ >= MAX_NUDGES) return { ok: false, reason: `no valid ${request.tool.name} call` };
      messages.push({ role: 'assistant', content: message.content });
      if (calls.length > 0) {
        // Every tool_use needs a matching tool_result before the next user turn.
        messages.push({
          role: 'user',
          content: calls.map((call, i) => ({
            type: 'tool_result' as const,
            tool_use_id: call.id,
            is_error: true,
            content: `Invalid input (${problems[i] ?? 'see the schema'}). ${NUDGE(request.tool.name)}`,
          })),
        });
      } else {
        messages.push({ role: 'user', content: NUDGE(request.tool.name) });
      }
      opts.log(`${tag} nudging for ${request.tool.name}`);
    }
  }

  return {
    usage,
    submit<T>(request: SubmitRequest<T>): Promise<Outcome<T>> {
      return gate(async (): Promise<Outcome<T>> => {
        if (fatal) return { ok: false, reason: `skipped: ${fatal}` };
        if (Date.now() > opts.softDeadline) return { ok: false, reason: 'time budget used up', deferred: true };
        if (request.signal?.aborted) return { ok: false, reason: 'cut off before it started', deferred: true };
        opts.log(`[${request.label}] started`);
        try {
          return await research(request);
        } catch (err) {
          if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
            fatal = describeError(err);
          }
          return { ok: false, reason: describeError(err) };
        }
      }, request.priority).then((outcome) => {
        if (!outcome.ok && !outcome.deferred) opts.log(`[${request.label}] failed: ${outcome.reason}`);
        return outcome;
      });
    },
  };
}
