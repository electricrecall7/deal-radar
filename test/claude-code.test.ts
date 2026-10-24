import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assessAuthStatus, extractJson, isPlanLimit, parseCliOutput, planEnv } from '../scripts/updater/claude-code';
import { DEFAULT_BUDGET_MINUTES, DEFAULT_MODEL, LOCAL_BUDGET_MINUTES, parseArgs, PLAN_DEFAULT_MODEL } from '../scripts/updater/config';

describe('extractJson', () => {
  it('reads a bare JSON reply', () => {
    assert.deepEqual(extractJson('{"deals":[],"notes":""}'), { deals: [], notes: '' });
  });

  it('reads JSON inside a code fence with words around it', () => {
    assert.deepEqual(extractJson('Done:\n```json\n{"verdicts":[{"id":"a"}]}\n```\nThanks'), {
      verdicts: [{ id: 'a' }],
    });
  });

  it('reads JSON after a sentence without a fence', () => {
    assert.deepEqual(extractJson('Here you go: {"a": {"b": 1}} '), { a: { b: 1 } });
  });

  it('throws when there is no JSON object', () => {
    assert.throws(() => extractJson('I could not find anything.'), /no JSON object/);
  });
});

describe('parseArgs engine', () => {
  it('uses the API with its defaults unless told otherwise', () => {
    const o = parseArgs([]);
    assert.equal(o.engine, 'api');
    assert.equal(o.model, DEFAULT_MODEL);
    assert.equal(o.budgetMinutes, DEFAULT_BUDGET_MINUTES);
  });

  it('--engine=claude-code uses the plan default model and the longer local budget', () => {
    const o = parseArgs(['--engine=claude-code']);
    assert.equal(o.engine, 'claude-code');
    assert.equal(o.model, PLAN_DEFAULT_MODEL);
    assert.equal(o.budgetMinutes, LOCAL_BUDGET_MINUTES);
  });

  it('keeps an explicit --budget and DEAL_MODEL with claude-code', () => {
    const o = parseArgs(['--engine=claude-code', '--budget=30'], { DEAL_MODEL: 'sonnet' });
    assert.equal(o.budgetMinutes, 30);
    assert.equal(o.model, 'sonnet');
  });

  it('reads DEAL_ENGINE, and the flag wins over it', () => {
    assert.equal(parseArgs([], { DEAL_ENGINE: 'claude-code' }).engine, 'claude-code');
    assert.equal(parseArgs(['--engine=api'], { DEAL_ENGINE: 'claude-code' }).engine, 'api');
  });

  it('rejects an unknown engine', () => {
    assert.throws(() => parseArgs(['--engine=grok']), /--engine must be one of/);
  });
});

describe('assessAuthStatus', () => {
  const status = (o: object) => JSON.stringify(o);

  it('passes a first-party Claude plan login', () => {
    const r = assessAuthStatus(0, status({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }));
    assert.deepEqual(r, { ok: true, method: 'claude.ai' });
    assert.equal(assessAuthStatus(0, status({ loggedIn: true, authMethod: 'oauth_token', apiProvider: 'firstParty' })).ok, true);
  });

  it('refuses when signed out', () => {
    assert.equal((assessAuthStatus(1, status({ loggedIn: false, authMethod: 'none' })) as { problem: string }).problem, 'signed-out');
    assert.equal((assessAuthStatus(0, status({ loggedIn: true, authMethod: 'none' })) as { problem: string }).problem, 'signed-out');
  });

  it('refuses an API key even when the login method still says claude.ai', () => {
    const r = assessAuthStatus(0, status({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' }));
    assert.deepEqual(r, { ok: false, problem: 'api-billing', detail: 'ANTHROPIC_API_KEY' });
  });

  it('refuses cloud providers and API-key logins', () => {
    const cloud = assessAuthStatus(0, status({ loggedIn: true, authMethod: 'third_party', apiProvider: 'bedrock' }));
    assert.deepEqual(cloud, { ok: false, problem: 'api-billing', detail: 'bedrock' });
    const key = assessAuthStatus(0, status({ loggedIn: true, authMethod: 'api_key_helper', apiProvider: 'firstParty' }));
    assert.deepEqual(key, { ok: false, problem: 'api-billing', detail: 'api_key_helper' });
  });

  it('fails closed when the provider is missing or the output is not JSON', () => {
    assert.equal(assessAuthStatus(0, status({ loggedIn: true, authMethod: 'claude.ai' })).ok, false);
    assert.equal((assessAuthStatus(0, 'Logged in as you@example.com') as { problem: string }).problem, 'unknown-login');
  });
});

describe('planEnv', () => {
  it('removes billing variables whatever their case and keeps the rest', () => {
    const input = { anthropic_api_key: 'k', ANTHROPIC_AUTH_TOKEN: 't', Claude_Code_Use_Bedrock: '1', PATH: 'p', HOME: 'h' };
    const env = planEnv(input as unknown as NodeJS.ProcessEnv);
    assert.deepEqual(env, { PATH: 'p', HOME: 'h' });
  });
});

describe('isPlanLimit', () => {
  it('recognises the CLI plan-limit wording', () => {
    assert.ok(isPlanLimit("You've hit your session limit · resets 3pm"));
    assert.ok(isPlanLimit("You've reached your weekly limit"));
    assert.ok(isPlanLimit("You're out of usage credits"));
  });

  it('does not stop the run for a passing rate limit', () => {
    assert.equal(isPlanLimit('API Error: 429 rate limit, retrying'), false);
    assert.equal(isPlanLimit('Too many requests'), false);
  });
});

describe('parseCliOutput', () => {
  const result = { type: 'result', subtype: 'success', result: '{}', session_id: 's' };

  it('reads a single result object', () => {
    assert.deepEqual(parseCliOutput(JSON.stringify(result)), result);
  });

  it('takes the result out of a verbose message array', () => {
    const verbose = [{ type: 'system', subtype: 'init' }, { type: 'assistant' }, result];
    assert.deepEqual(parseCliOutput(JSON.stringify(verbose)), result);
  });

  it('skips stray lines before the JSON', () => {
    const newline = String.fromCharCode(10);
    assert.deepEqual(parseCliOutput(['warning: something', JSON.stringify(result), ''].join(newline)), result);
  });

  it('returns null when there is no result', () => {
    assert.equal(parseCliOutput('not json at all'), null);
    assert.equal(parseCliOutput(JSON.stringify([{ type: 'assistant' }])), null);
  });
});
