import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ClaudeUsageService, parseClaudeUsage, parseSessionUsage, readAgentTranscript, sessionUsage, ticketUsage, validateRange } from '../integrations/claude-usage';
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

const turn = (id: string, requestId: string, model: string, usage: Record<string, number>) => JSON.stringify({ requestId, message: { id, model, usage } });

test('ccusage claude session JSON gives totals and tokens and listed cost per model, null is no such session', () => {
  const session = parseSessionUsage({
    sessionId: 's', totalTokens: 300, totalCost: 3,
    entries: [
      { model: 'opus', inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40, costUSD: 0 },
      { model: 'opus', inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: 0 },
      { model: 'sonnet', inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: 0 },
    ],
  });
  assert.equal(session?.totalTokens, 300);
  assert.equal(session?.totalCost, 3);
  assert.deepEqual([...(session?.models ?? [])], [['opus', { tokens: 200, cost: 0 }], ['sonnet', { tokens: 100, cost: 0 }]]);
  assert.equal(parseSessionUsage(null), null);
  assert.throws(() => parseSessionUsage({ totalCost: 1 }));
});

test('a subagent transcript counts each message.id + requestId once across agents and keeps the largest turn context', () => {
  const seen = new Set<string>();
  const first = readAgentTranscript('a1', 'sous-reviewer', [
    turn('m1', 'r1', 'opus', { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }),
    turn('m1', 'r1', 'opus', { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 9 }),
    turn('m2', 'r2', 'opus', { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 300, output_tokens: 1 }),
    '{"type":"user","message":{"role":"user","content":"hi"}}',
    'not json',
  ].join('\n'), seen);
  assert.equal(first.totalTokens, 116 + 303);
  assert.equal(first.peakContext, 302);
  assert.deepEqual([...first.models], [['opus', 419]]);
  const second = readAgentTranscript('a2', 'browser-verifier', turn('m2', 'r2', 'opus', { input_tokens: 2, cache_read_input_tokens: 300, output_tokens: 1 }), seen);
  assert.equal(second.totalTokens, 0, 'a message another agent already counted is not counted again');
});

test('per-agent cost splits the ccusage session cost by token weight per model and main is what the subagents did not use', () => {
  const session = { totalTokens: 1000, totalCost: 10, models: new Map([['opus', { tokens: 800, cost: 0 }], ['sonnet', { tokens: 200, cost: 0 }]]), from: null, to: null };
  const usage = sessionUsage(session, [
    { agentId: 'a1', name: 'sous-pr-reviewer', models: new Map([['opus', 400]]), totalTokens: 400, peakContext: 90 },
    { agentId: 'a2', name: 'browser-verifier', models: new Map([['sonnet', 100]]), totalTokens: 100, peakContext: 40 },
    { agentId: 'a3', name: 'idle', models: new Map(), totalTokens: 0, peakContext: 0 },
  ]);
  assert.equal(usage.totalCost, 10);
  assert.equal(usage.mainTokens, 500);
  assert.deepEqual(usage.agents.map((agent) => [agent.agentId, agent.model, agent.totalTokens, agent.peakContext, Math.round(agent.cost * 100) / 100]), [['a1', 'opus', 400, 90, 4], ['a2', 'sonnet', 100, 40, 1]]);
  const listed = sessionUsage({ ...session, models: new Map([['opus', { tokens: 800, cost: 6 }], ['sonnet', { tokens: 200, cost: 2 }]]) }, [
    { agentId: 'a2', name: 'browser-verifier', models: new Map([['sonnet', 100]]), totalTokens: 100, peakContext: 40 },
  ]);
  assert.equal(listed.agents[0].cost, 1.25, 'a listed model cost is scaled to the session total, then split by tokens');
  const priced = sessionUsage(session, [
    { agentId: 'a1', name: 'sous-pr-reviewer', models: new Map([['opus', 400]]), totalTokens: 400, peakContext: 90 },
    { agentId: 'a2', name: 'browser-verifier', models: new Map([['sonnet', 100]]), totalTokens: 100, peakContext: 40 },
  ], new Map([['opus', 4], ['sonnet', 1]]));
  assert.deepEqual(priced.agents.map((agent) => Math.round(agent.cost * 1000) / 1000), [4.706, 0.294], 'the daily price of each model weighs its tokens');
});

test('a ticket adds up every found session, and one unreadable session makes it unavailable', () => {
  const agent = { agentId: 'a', name: 'x', model: 'opus', totalTokens: 5, peakContext: 1, cost: 0.5 };
  const found = { available: true, found: true, totalTokens: 10, totalCost: 1, mainTokens: 5, agents: [agent], error: null };
  const missing = { available: true, found: false, totalTokens: 0, totalCost: 0, mainTokens: 0, agents: [], error: null };
  const total = ticketUsage([found, { ...found, totalTokens: 20, totalCost: 2, mainTokens: 20, agents: [] }, missing]);
  assert.deepEqual(total, { available: true, sessions: 2, totalTokens: 30, totalCost: 3, mainTokens: 25, agents: [agent], error: null });
  assert.equal(ticketUsage([found, { ...missing, available: false }]).available, false);
});

test('session usage runs ccusage session with the id, reads the session subagents folder, and is unavailable without ccusage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccusage-projects-'));
  const dir = join(root, 'E--project', 'sess-1', 'subagents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent-abc.jsonl'), turn('m1', 'r1', 'opus', { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 80 }));
  writeFileSync(join(dir, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'sous-pr-reviewer' }));
  writeFileSync(join(dir, 'agent-def.jsonl'), turn('m2', 'r2', 'sonnet', { input_tokens: 5, output_tokens: 5 }));
  const calls: string[][] = [];
  const service = new ClaudeUsageService(() => 'ccusage', async (_bin, args) => {
    calls.push(args);
    return { stdout: args[4] === 'sess-1' ? JSON.stringify({ sessionId: 'sess-1', totalTokens: 400, totalCost: 4, entries: [{ model: 'opus', inputTokens: 300, costUSD: 0 }, { model: 'sonnet', inputTokens: 100, costUSD: 0 }] }) : 'null' };
  }, Date.now, () => root);
  const usage = await service.session('sess-1');
  assert.deepEqual(calls[0], ['claude', 'session', '--json', '--id', 'sess-1']);
  assert.equal(usage.totalTokens, 400);
  assert.equal(usage.mainTokens, 290);
  assert.deepEqual(usage.agents.map((agent) => [agent.agentId, agent.name, agent.model, agent.totalTokens, agent.peakContext]), [['abc', 'sous-pr-reviewer', 'opus', 100, 90], ['def', 'agent', 'sonnet', 10, 5]]);
  await service.session('sess-1');
  assert.equal(calls.length, 1, 'a session answer is kept for 60 seconds');
  assert.deepEqual(await service.session('other'), { available: true, found: false, totalTokens: 0, totalCost: 0, mainTokens: 0, agents: [], error: null });
  const ticket = await service.ticket(['sess-1', 'other', 'bad id;']);
  assert.equal(ticket.sessions, 1);
  assert.equal(ticket.totalCost, 4);
  await assert.rejects(() => service.session('../x'), OrchestratorInputError);
  const missing = new ClaudeUsageService(() => 'nope', async () => { throw Object.assign(new Error('spawn nope ENOENT'), { code: 'ENOENT' }); }, Date.now, () => root);
  assert.deepEqual(await missing.session('sess-1'), { available: false, found: false, totalTokens: 0, totalCost: 0, mainTokens: 0, agents: [], error: null });
  assert.equal((await missing.ticket(['sess-1'])).available, false);
  rmSync(root, { recursive: true, force: true });
});
