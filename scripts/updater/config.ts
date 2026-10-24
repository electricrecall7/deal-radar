// Knobs for the weekly updater and its command-line flags.

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export const MAX_TOKENS = 32000;
/** Requests in flight at once, across every step. */
export const CONCURRENCY = 3;
export const SDK_MAX_RETRIES = 4;
/** One HTTP attempt; a long web-research turn can take several minutes. */
export const REQUEST_TIMEOUT_MS = 15 * 60_000;
/**
 * Wall-clock limit for one research request, every attempt and pause_turn continuation included, so one
 * slow request can't sit on a slot for the whole run.
 */
export const MAX_RESEARCH_MINUTES = 12;
/** pause_turn continuations allowed per request before giving up. */
export const MAX_CONTINUATIONS = 10;
/** "Call submit_... now" reminders allowed per request. */
export const MAX_NUDGES = 2;

export const VERIFY_BATCH = 8;
export const VERIFY_SEARCHES = 6;
export const VERIFY_FETCHES = 6;
/** Deals checked this recently are skipped, so a manual re-run doesn't pay to check them again. */
export const VERIFY_FRESH_DAYS = 3;
export const DISCOVER_SEARCHES = 12;
export const DISCOVER_FETCHES = 8;
export const BENEFITS_SEARCHES = 10;
/** Restaurants per promo-code request, and that request's search limits. */
export const CODE_BATCH = 12;
export const CODE_SEARCHES = 10;
export const CODE_FETCHES = 10;
export const BENEFITS_FETCHES = 10;
/** Keeps one chatty angle from blowing up the skeptic pass. */
export const MAX_CANDIDATES_PER_ANGLE = 20;
export const MAX_SKEPTIC_CANDIDATES = 48;
export const SEARCH_COST_PER_1000 = 10;

// The workflow is killed at 60 minutes and commits nothing, so stop starting new requests at the soft
// limit and abort whatever is still running at the hard limit, then write what finished.
export const DEFAULT_BUDGET_MINUTES = 42;
export const HARD_STOP_GRACE_MINUTES = 6;
/**
 * Discovery angles still running this long before the soft limit are cut off, so the skeptic pass has
 * time to check what the others found. A short --budget keeps half of it for discovery instead.
 */
export const SKEPTIC_RESERVE_MINUTES = 10;

/**
 * Which waiting request gets the next free slot (lower first). A few hundred deals can't all be
 * verified inside the time budget, so verification fills whatever time discovery leaves; deals it
 * doesn't reach are least recently verified, so they go first next week.
 */
export const PRIORITY = { discover: 0, skeptic: 1, benefits: 2, verify: 3 } as const;

export const SA_LOCATION = {
  type: 'approximate',
  city: 'San Antonio',
  region: 'Texas',
  country: 'US',
  timezone: 'America/Chicago',
} as const;

export interface Options {
  dryRun: boolean;
  skipVerify: boolean;
  skipDiscover: boolean;
  skipBenefits: boolean;
  /** Promo-code sweep: run it with everything else, skip it, or run only it. */
  codes: 'include' | 'skip' | 'only';
  /** Discovery angles to run; undefined means all of them. */
  angles?: string[];
  /** Most deals to verify this run; undefined means all. */
  limit?: number;
  budgetMinutes: number;
  model: string;
  effort: Effort;
  help: boolean;
}

export const USAGE = `Usage: npx tsx scripts/update-deals.ts [flags]

  --dry-run         No API calls: prune ended deals, validate, and print what would change.
  --skip-verify     Don't re-check existing deals.
  --skip-discover   Don't search for new deals (also skips the skeptic pass).
  --skip-benefits   Don't re-check card benefits and earn rates.
  --skip-codes      Don't run the promo-code sweep.
  --only-codes      Run only the promo-code sweep (and its skeptic pass) for the restaurants in
                    data/code-watchlist.json plus any restaurant with 2+ deals.
  --angles=a,b      Only run these discovery angles (promo-codes selects the code sweep).
  --limit=N         Verify at most N deals (least recently checked first).
  --budget=MIN      Stop starting new requests after MIN minutes (default ${DEFAULT_BUDGET_MINUTES}).
  --help            Show this help.

Env: ANTHROPIC_API_KEY (required unless --dry-run), DEAL_MODEL (default ${DEFAULT_MODEL}),
     DEAL_EFFORT (low|medium|high|xhigh|max, default high),
     DEAL_DATA_DIR (read and write deals.json / last-run.json there instead of data/).`;

function positiveInt(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a whole number above 0, got "${value}"`);
  return n;
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): Options {
  const effort = (env.DEAL_EFFORT?.trim() || 'high') as Effort;
  if (!EFFORTS.includes(effort)) throw new Error(`DEAL_EFFORT must be one of ${EFFORTS.join(', ')}`);
  const opts: Options = {
    dryRun: false,
    skipVerify: false,
    skipDiscover: false,
    skipBenefits: false,
    codes: 'include',
    budgetMinutes: DEFAULT_BUDGET_MINUTES,
    model: env.DEAL_MODEL?.trim() || DEFAULT_MODEL,
    effort,
    help: false,
  };
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    const flag = eq < 0 ? arg : arg.slice(0, eq);
    const value = eq < 0 ? '' : arg.slice(eq + 1);
    switch (flag) {
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--skip-verify':
        opts.skipVerify = true;
        break;
      case '--skip-discover':
        opts.skipDiscover = true;
        break;
      case '--skip-benefits':
        opts.skipBenefits = true;
        break;
      case '--skip-codes':
        opts.codes = 'skip';
        break;
      case '--only-codes':
        opts.codes = 'only';
        opts.skipVerify = true;
        opts.skipBenefits = true;
        break;
      case '--angles':
        opts.angles = value.split(',').map((a) => a.trim()).filter(Boolean);
        if (opts.angles.length === 0) throw new Error('--angles needs a comma-separated list');
        break;
      case '--limit':
        opts.limit = positiveInt(flag, value);
        break;
      case '--budget':
        opts.budgetMinutes = positiveInt(flag, value);
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown flag "${arg}"`);
    }
  }
  return opts;
}
