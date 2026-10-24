// The same research requests as claude.ts, run through the Claude Code CLI ("claude -p") on this PC so
// they use the person's Claude plan instead of an API key. Claude Code does the web searching with its
// own WebSearch / WebFetch tools and answers with the submit tool's input as plain JSON.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { z } from 'zod';

import { createLimiter, emptyUsage, type Outcome, type Researcher, type ResearcherOptions, type SubmitRequest } from './claude';
import { CLAUDE_CODE_CONCURRENCY, CLAUDE_CODE_MAX_TURNS, CLAUDE_CODE_REQUEST_MINUTES, PLAN_DEFAULT_MODEL } from './config';
import { SYSTEM_PROMPT } from './prompts';

const IS_WINDOWS = process.platform === 'win32';

/** What `claude -p --output-format json` prints when it finishes. */
export interface CliResult {
  type?: string;
  /** 'success', or error_max_turns / error_during_execution / ... (those carry `errors`, not `result`). */
  subtype?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  api_error_status?: number | null;
  session_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number };
  };
}

// Any of these would make the CLI bill an API key, a cloud account or another endpoint instead of the
// signed-in plan. Windows treats names case-insensitively, so they're matched that way too.
const BILLING_ENV = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_ORGANIZATION_ID',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
]);

export function planEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) if (BILLING_ENV.has(key.toUpperCase())) delete env[key];
  return env;
}

interface Launcher {
  command: string;
  prefix: string[];
}

let launcher: Launcher | null | undefined;

/**
 * How to start the CLI without a shell, so the process is the direct child (Ctrl+C and crashes take it
 * down with us) and arguments need no quoting. The native installer puts claude.exe in
 * %USERPROFILE%\.local\bin, which is often not on PATH; npm installs a claude.cmd wrapper around cli.js.
 */
export function findClaude(): Launcher | null {
  if (launcher !== undefined) return launcher;
  launcher = null;
  // An explicit path wins (unusual installs, and tests that must never start the real CLI).
  const override = process.env.DEAL_CLAUDE_BIN?.trim();
  if (override) {
    if (!fs.existsSync(override)) return launcher;
    return (launcher = /\.(c|m)?js$/i.test(override)
      ? { command: process.execPath, prefix: [override] }
      : { command: override, prefix: [] });
  }
  if (!IS_WINDOWS) {
    if (spawnSync('claude', ['--version'], { stdio: 'ignore', timeout: 30_000 }).status === 0) {
      launcher = { command: 'claude', prefix: [] };
    }
    return launcher;
  }
  const candidates = [path.join(os.homedir(), '.local', 'bin', 'claude.exe')];
  const where = spawnSync('where', ['claude'], { encoding: 'utf8', timeout: 30_000 });
  if (where.status === 0) candidates.push(...where.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  for (const found of candidates) {
    if (!fs.existsSync(found)) continue;
    if (/\.exe$/i.test(found)) return (launcher = { command: found, prefix: [] });
    if (/\.cmd$/i.test(found)) {
      const cli = path.join(path.dirname(found), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(cli)) return (launcher = { command: process.execPath, prefix: [cli] });
    }
  }
  return launcher;
}

export type PlanCheck =
  | { ok: true; method: string }
  | { ok: false; problem: 'not-installed' | 'signed-out' | 'api-billing' | 'unknown-login'; detail?: string };

/**
 * Reads `claude auth status`. Fails closed: only a first-party Claude plan login with no API key in
 * play passes. A key or provider switch can also come from Claude Code's own settings files, which
 * scrubbing our environment can't reach, so the status fields are what decide.
 */
export function assessAuthStatus(exitCode: number | null, stdout: string): PlanCheck {
  let s: { loggedIn?: boolean; authMethod?: string; apiProvider?: string; apiKeySource?: string };
  try {
    s = JSON.parse(stdout);
  } catch {
    return exitCode === 0
      ? { ok: false, problem: 'unknown-login', detail: stdout.trim().slice(0, 200) }
      : { ok: false, problem: 'signed-out' };
  }
  if (exitCode !== 0 || s.loggedIn === false || s.authMethod === 'none') return { ok: false, problem: 'signed-out' };
  if (s.apiKeySource && s.apiKeySource !== 'none') return { ok: false, problem: 'api-billing', detail: s.apiKeySource };
  if (s.apiProvider !== 'firstParty') {
    return { ok: false, problem: 'api-billing', detail: s.apiProvider ?? 'unknown provider' };
  }
  if (s.authMethod !== 'claude.ai' && s.authMethod !== 'oauth_token') {
    return { ok: false, problem: 'api-billing', detail: s.authMethod ?? 'unknown login' };
  }
  return { ok: true, method: s.authMethod };
}

export function checkClaudeCodePlan(): PlanCheck {
  const cli = findClaude();
  if (!cli) return { ok: false, problem: 'not-installed' };
  const r = spawnSync(cli.command, [...cli.prefix, 'auth', 'status'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: planEnv(),
    windowsHide: true,
  });
  return assessAuthStatus(r.status, r.stdout ?? '');
}

// The CLI's own wording for plan limits ("You've hit your session limit · resets 3pm", "You've reached
// your ... limit", "You're out of usage credits"). A plain rate-limit retry is not a reason to stop.
const PLAN_LIMIT = /You['’]ve (hit|reached) your|You['’]re out of (usage credits|extra usage)|out of usage|usage limit/i;

export function isPlanLimit(text: string): boolean {
  return PLAN_LIMIT.test(text);
}

/**
 * The result object from the CLI's stdout. A "verbose" Claude Code setting makes json mode print every
 * message as an array, and stray lines can precede the JSON, so take the last result object found.
 */
export function parseCliOutput(stdout: string): CliResult | null {
  const pick = (v: unknown): CliResult | null => {
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        const item = v[i] as CliResult;
        if (item && item.type === 'result') return item;
      }
      return null;
    }
    return v && typeof v === 'object' ? (v as CliResult) : null;
  };
  const trimmed = stdout.trim();
  try {
    return pick(JSON.parse(trimmed));
  } catch {
    const lines = trimmed.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const found = pick(JSON.parse(lines[i]));
        if (found && found.type === 'result') return found;
      } catch {
        // not this line
      }
    }
    return null;
  }
}

/** The short prompt argument; the full task arrives on stdin, as in `cat task.txt | claude -p "..."`. */
const PROMPT_ARG = 'Do the research task in the piped input and answer exactly as it says at the end.';

function promptFor(request: SubmitRequest<unknown>): string {
  const task = request.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n\n');
  return `${SYSTEM_PROMPT}

---

${task}

---

How to answer (this replaces "call ${request.tool.name}"):
- Research with the WebSearch and WebFetch tools only: about ${request.searches} searches and ${request.fetches} page fetches at most. Don't use any other tool and don't create or edit files.
- When you're done, reply with ONLY one JSON object, with no other text and no code fences. It must match this JSON Schema, which is the input of ${request.tool.name}:
${JSON.stringify(request.tool.input_schema)}`;
}

/** The JSON object in a reply, even if the model wrapped it in a code fence or a sentence. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the reply');
  return JSON.parse(body.slice(start, end + 1));
}

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
}

/** Ends the CLI and anything it started. */
function kill(pid: number | undefined) {
  if (!pid) return;
  try {
    if (IS_WINDOWS) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

// Every CLI process still running, so Ctrl+C or an early exit doesn't leave research sessions behind.
const live = new Set<ChildProcess>();
let exitHooks = false;
function trackExit() {
  if (exitHooks) return;
  exitHooks = true;
  process.on('exit', () => live.forEach((c) => kill(c.pid)));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.once(sig, () => {
      live.forEach((c) => kill(c.pid));
      process.exit(130);
    });
  }
}

/** Claude Code keeps a transcript per session under ~/.claude/projects/<folder name with - for symbols>. */
function transcriptDir(workDir: string): string {
  return path.join(os.homedir(), '.claude', 'projects', workDir.replace(/[^A-Za-z0-9]/g, '-'));
}

export function createClaudeCodeResearcher(opts: ResearcherOptions): Researcher {
  const usage = emptyUsage();
  const gate = createLimiter(CLAUDE_CODE_CONCURRENCY);
  let fatal: string | undefined;
  // One stable, empty folder: Claude Code picks up no CLAUDE.md, hooks or plugins from this project, and
  // its transcripts land in a single project folder that each request cleans up after itself.
  const workDir = path.join(os.tmpdir(), 'deal-radar-claude');
  const env = planEnv();
  const cli = findClaude();

  function runCli(args: string[], input: string, signal: AbortSignal, deadline: number): Promise<CliResult> {
    if (!cli) return Promise.reject(new Error('Claude Code is not installed'));
    fs.mkdirSync(workDir, { recursive: true });
    trackExit();
    return new Promise((resolve, reject) => {
      const child = spawn(cli.command, [...cli.prefix, ...args], { cwd: workDir, env, windowsHide: true });
      live.add(child);
      let out = '';
      let err = '';
      let settled = false;
      const stop = () => kill(child.pid);
      const timer = setTimeout(stop, Math.max(1_000, deadline - Date.now()));
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        live.delete(child);
        fn();
      };
      signal.addEventListener('abort', stop, { once: true });
      child.stdout?.setEncoding('utf8').on('data', (d: string) => (out += d));
      child.stderr?.setEncoding('utf8').on('data', (d: string) => (err += d));
      // A prompt bigger than the pipe buffer plus an early exit would otherwise crash the whole run.
      child.stdin?.on('error', () => undefined);
      child.on('error', (e) => finish(() => reject(e)));
      child.on('close', (code) =>
        finish(() => {
          if (signal.aborted || Date.now() >= deadline) return reject(new Error('stopped at the time limit'));
          const result = parseCliOutput(out);
          if (result) return resolve(result);
          const why = (err || out).trim().split('\n').slice(-3).join(' ').slice(0, 300);
          reject(new Error(`claude exited with code ${code}${why ? `: ${why}` : ''}`));
        }),
      );
      child.stdin?.end(input);
    });
  }

  function count(result: CliResult) {
    usage.requests++;
    const u = result.usage;
    if (!u) return;
    usage.inputTokens += u.input_tokens ?? 0;
    usage.outputTokens += u.output_tokens ?? 0;
    usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    usage.webSearches += u.server_tool_use?.web_search_requests ?? 0;
    usage.webFetches += u.server_tool_use?.web_fetch_requests ?? 0;
  }

  function forget(sessions: string[]) {
    const dir = transcriptDir(workDir);
    for (const id of sessions) fs.rmSync(path.join(dir, `${id}.jsonl`), { force: true });
  }

  async function research<T>(request: SubmitRequest<T>): Promise<Outcome<T>> {
    const started = Date.now();
    const deadline = Math.min(opts.hardDeadline, started + CLAUDE_CODE_REQUEST_MINUTES * 60_000);
    const signal = AbortSignal.any([
      AbortSignal.timeout(Math.max(1_000, deadline - started)),
      ...(request.signal ? [request.signal] : []),
    ]);
    // The prompt goes first: --tools and --allowedTools take several values and would swallow it.
    const base = [PROMPT_ARG, '-p', '--output-format', 'json', '--max-turns', String(CLAUDE_CODE_MAX_TURNS)];
    if (opts.model !== PLAN_DEFAULT_MODEL) base.push('--model', opts.model);
    // Only the two web tools exist in the session, they run without asking, and no MCP servers load.
    base.push('--strict-mcp-config', '--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch');

    const sessions: string[] = [];
    let input = promptFor(request as SubmitRequest<unknown>);
    let args = base;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        let result: CliResult;
        try {
          result = await runCli(args, input, signal, deadline);
        } catch (e) {
          if (request.signal?.aborted) return { ok: false, reason: 'cut off before it finished', deferred: true };
          return { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
        count(result);
        if (result.session_id) sessions.push(result.session_id);
        const text = result.result ?? '';
        if (result.is_error || (result.subtype && result.subtype !== 'success')) {
          const why = [text, ...(result.errors ?? [])].filter(Boolean).join('; ');
          if (isPlanLimit(why)) {
            fatal = `your Claude plan hit a usage limit (${why.slice(0, 120)})`;
            opts.log(`Stopping: ${fatal}. Requests not started yet are deferred to the next run.`);
            return { ok: false, reason: fatal, deferred: true };
          }
          return { ok: false, reason: `Claude Code stopped (${result.subtype ?? 'error'}): ${why.slice(0, 200)}` };
        }
        let problem: string;
        try {
          const parsed = request.schema.safeParse(extractJson(text));
          if (parsed.success) {
            opts.log(`[${request.label}] done in ${((Date.now() - started) / 60_000).toFixed(1)} min`);
            return { ok: true, value: parsed.data };
          }
          problem = issues(parsed.error);
        } catch (e) {
          problem = e instanceof Error ? e.message : String(e);
        }
        if (!result.session_id || attempt > 0) return { ok: false, reason: `invalid answer: ${problem}` };
        // Ask once more in the same conversation, so the research isn't repeated.
        opts.log(`[${request.label}] answer didn't match the schema (${problem}); asking again`);
        args = [...base, '--resume', result.session_id];
        input = `Your reply couldn't be used: ${problem}. Reply again with ONLY the corrected JSON object for ${request.tool.name}, no other text.`;
      }
      return { ok: false, reason: 'no valid answer' };
    } finally {
      // The transcripts hold every fetched page; nothing reads them after the request is done.
      try {
        forget(sessions);
      } catch {
        // best effort
      }
    }
  }

  const researcher: Researcher = {
    usage,
    submit<T>(request: SubmitRequest<T>): Promise<Outcome<T>> {
      return gate(async (): Promise<Outcome<T>> => {
        if (fatal) return { ok: false, reason: `skipped: ${fatal}`, deferred: true };
        if (Date.now() > opts.softDeadline) return { ok: false, reason: 'time budget used up', deferred: true };
        if (request.signal?.aborted) return { ok: false, reason: 'cut off before it started', deferred: true };
        opts.log(`[${request.label}] started`);
        const outcome = await research(request);
        if (fatal) researcher.notice = fatal;
        return outcome;
      }, request.priority).then((outcome) => {
        if (!outcome.ok && !outcome.deferred) opts.log(`[${request.label}] failed: ${outcome.reason}`);
        return outcome;
      });
    },
  };
  return researcher;
}
