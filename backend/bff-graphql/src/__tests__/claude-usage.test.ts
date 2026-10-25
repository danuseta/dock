import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ClaudeUsageService, parseClaudeUsage, validateRange } from '../integrations/claude-usage';
import { OrchestratorInputError } from '../integrations/orchestrator';

const fixture = readFileSync(join(__dirname, 'fixtures', 'ccusage-claude-daily.json'), 'utf8');

test('ccusage claude daily JSON becomes totals, days and models', () => {
  const usage = parseClaudeUsage(JSON.parse(fixture));
  assert.equal(usage.available, true);
  assert.deepEqual(usage.days.map((day) => day.date), ['2026-10-01', '2026-10-02']);
  assert.equal(usage.totals?.totalTokens, 322_984_397);
  assert.equal(usage.totals?.totalTokens, usage.days.reduce((total, day) => total + day.totalTokens, 0));
  assert.equal(usage.totals?.inputTokens, 1862);
  assert.equal(usage.totals?.outputTokens, 441_371);
  assert.equal(usage.totals?.cacheCreationTokens, 5_762_426);
  assert.equal(usage.totals?.cacheReadTokens, 316_778_738);
  assert.ok(Math.abs((usage.totals?.cost ?? 0) - 110.99255829999996) < 1e-9);
  assert.equal(usage.models[0].model, 'claude-opus-5-5', 'models are ordered by cost');
  assert.equal(usage.models[0].inputTokens, 1712, 'a model is added up over the days');
  assert.equal(usage.models[0].totalTokens, 315_494_938);
});

test('a model seen on two days is added up and an empty range has zero totals', () => {
  const row = (date: string) => ({ date, inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4, totalCost: 0.5, modelBreakdowns: [{ modelName: 'm', inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4, cost: 0.5 }] });
  const usage = parseClaudeUsage({ daily: [row('2026-10-02'), row('2026-10-01')] });
  assert.deepEqual(usage.days.map((day) => day.date), ['2026-10-01', '2026-10-02']);
  assert.deepEqual(usage.models, [{ model: 'm', inputTokens: 2, outputTokens: 4, cacheCreationTokens: 6, cacheReadTokens: 8, totalTokens: 20, cost: 1 }]);
  assert.equal(parseClaudeUsage({ daily: [] }).totals?.totalTokens, 0);
  assert.throws(() => parseClaudeUsage({ nope: true }));
});

test('the range must be real YYYY-MM-DD dates, in order, and at most 366 days', () => {
  validateRange('2026-10-01', '2026-10-01');
  validateRange('2025-10-25', '2026-10-25');
  for (const [from, to] of [['20261001', '2026-10-02'], ['2026-02-30', '2026-03-01'], ['2026-10-02', '2026-10-01'], ['2025-10-24', '2026-10-25'], ['2026-10-01; rm', '2026-10-02']]) {
    assert.throws(() => validateRange(from, to), OrchestratorInputError, `${from}..${to}`);
  }
});

test('ccusage runs without a shell, with the dates as YYYYMMDD, and the answer is kept for 60 seconds per range', async () => {
  const calls: Array<[string, string[]]> = [];
  let clock = 1_000;
  const service = new ClaudeUsageService(() => 'ccusage-test', async (bin, args) => { calls.push([bin, args]); return { stdout: fixture }; }, () => clock);
  await service.usage('2026-10-01', '2026-10-02');
  await service.usage('2026-10-01', '2026-10-02');
  assert.deepEqual(calls, [['ccusage-test', ['claude', 'daily', '--json', '--since', '20261001', '--until', '20261002']]]);
  await service.usage('2026-10-01', '2026-10-03');
  assert.equal(calls.length, 2, 'another range is another entry');
  clock += 60_000;
  await service.usage('2026-10-01', '2026-10-02');
  assert.equal(calls.length, 3, 'an entry expires after 60 seconds');
});

test('a missing binary is unavailable, any other failure is an error, and bad input never reaches the binary', async () => {
  let ran = 0;
  const missing = new ClaudeUsageService(() => 'nope', async () => { ran += 1; throw Object.assign(new Error('spawn nope ENOENT'), { code: 'ENOENT' }); });
  assert.deepEqual(await missing.usage('2026-10-01', '2026-10-02'), { available: false, totals: null, days: [], models: [], error: null });
  const broken = new ClaudeUsageService(() => 'ccusage', async () => ({ stdout: 'not json' }));
  const failed = await broken.usage('2026-10-01', '2026-10-02');
  assert.equal(failed.available, false);
  assert.ok(failed.error);
  await assert.rejects(() => missing.usage('x', 'y'), OrchestratorInputError);
  assert.equal(ran, 1);
});

test('an unavailable answer is not cached, so installing ccusage shows usage on the next look', async () => {
  let installed = false;
  const service = new ClaudeUsageService(() => 'ccusage', async () => {
    if (!installed) throw Object.assign(new Error('spawn ccusage ENOENT'), { code: 'ENOENT' });
    return { stdout: JSON.stringify({ daily: [] }) };
  });
  assert.equal((await service.usage('2026-10-01', '2026-10-07')).available, false);
  installed = true;
  assert.equal((await service.usage('2026-10-01', '2026-10-07')).available, true);
});
