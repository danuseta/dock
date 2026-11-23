import assert from 'node:assert';
import test from 'node:test';
import { QaAuto, isRunVideo, newestRun, parseProgress, parseResults, qaPrompt, readTrigger, revisionPrompt, runPullRequests, type QaAutoDeps, type QaRun, type QaTrigger } from '../integrations/qa-local';
import type { RunPullRequest } from '../integrations/orchestrator';

const NOW = new Date('2026-11-04T08:00:00.000Z');
const BE = 'https://github.com/qonekid/ms-admin-worker-backend/pull/1300';
const FE = 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/1400';
const pr = (url: string): RunPullRequest => ({ url, number: Number(url.split('/').pop()), repo: 'qonekid/x', status: 'open' });

const progress = (extra: Record<string, unknown> = {}) => JSON.stringify({
  key: 'QRD-1286',
  runId: '20261104T071926Z',
  pid: 4242,
  state: 'running',
  step: 'tests',
  steps: [{ id: 'stack', label: 'Stack', state: 'done' }, { id: 'tests', label: 'Tests', state: 'running' }],
  tcs: [
    { id: 'QRD-1286-TC001', title: 'own avatar', ac: [1], state: 'passed', seconds: 23.4, video: 'videos/QRD-1286-TC001.webm', note: null },
    { id: 'QRD-1286-TC002', title: 'two tabs', ac: [1], state: 'running', seconds: null, video: null, note: null },
    { id: 'QRD-1286-TC008', title: 'manual', ac: [4], state: 'skipped', seconds: null, video: null, note: 'manual' },
  ],
  startedAt: '2026-11-04T07:19:26.000Z',
  updatedAt: '2026-11-04T07:21:00.000Z',
  ...extra,
});

test('a running progress file reads as running while its process lives', () => {
  const run = parseProgress(progress(), () => true);
  assert.ok(run);
  assert.strictEqual(run.state, 'running');
  assert.strictEqual(run.step, 'tests');
  assert.deepStrictEqual(run.tcs.map((tc) => tc.state), ['passed', 'running', 'skipped']);
  assert.deepStrictEqual([run.passed, run.failed, run.blocked], [1, 0, 1]);
});

test('a running progress file whose process is gone reads as failed', () => {
  const run = parseProgress(progress(), () => false);
  assert.strictEqual(run?.state, 'failed');
  assert.strictEqual(run?.error, 'The run stopped before it wrote a result');
});

test('a finished progress file keeps its verdict and rule', () => {
  const run = parseProgress(progress({ state: 'done', verdict: 'ESCALATED', rule: 'J-ESCALATED' }), () => false);
  assert.strictEqual(run?.state, 'done');
  assert.strictEqual(run?.verdict, 'ESCALATED');
  assert.strictEqual(run?.rule, 'J-ESCALATED');
});

test('a progress file that is not JSON, or has no key, is no run', () => {
  assert.strictEqual(parseProgress('{', () => true), null);
  assert.strictEqual(parseProgress(JSON.stringify({ runId: 'x' }), () => true), null);
});

test('a run from before progress.json reads from results.json', () => {
  const run = parseResults(JSON.stringify({
    key: 'QRD-1286',
    runId: '20261104T040500Z',
    startedAt: '2026-11-04T04:05:00.000Z',
    finishedAt: '2026-11-04T04:12:00.000Z',
    verdict: { prediction: 'ESCALATED', rule: 'J-ESCALATED' },
    infraError: null,
    tcs: [
      { id: 'QRD-1286-TC001', title: 't1', ac: [1], qaStatus: 'Passed', durationMs: 2000, video: 'videos/a.webm', notes: null },
      { id: 'QRD-1286-TC002', title: 't2', ac: [2], qaStatus: 'Failed', durationMs: 1000, video: null, finding: 'avatar shown\nmore' },
      { id: 'QRD-1286-TC003', title: 't3', ac: [3], qaStatus: 'Blocked', durationMs: 0, video: null, notes: 'setup failed' },
    ],
  }));
  assert.ok(run);
  assert.strictEqual(run.state, 'done');
  assert.deepStrictEqual(run.tcs.map((tc) => tc.state), ['passed', 'failed', 'blocked']);
  assert.strictEqual(run.tcs[0].seconds, 2);
  assert.strictEqual(run.tcs[1].note, 'avatar shown');
  assert.strictEqual(run.verdict, 'ESCALATED');
});

test('the newest run folder wins and other names are ignored', () => {
  assert.strictEqual(newestRun(['20261104T040500Z', 'notes', '20261104T071926Z', '20261104T070645Z']), '20261104T071926Z');
  assert.strictEqual(newestRun(['tmp']), null);
});

test('only webm files under videos/ are served', () => {
  assert.ok(isRunVideo('videos/QRD-1286-TC001.webm'));
  assert.ok(!isRunVideo('videos/../results.json'));
  assert.ok(!isRunVideo('auth/local.json'));
  assert.ok(!isRunVideo('videos/.hidden.webm'));
});

test('the pull requests of a run are deduplicated and sorted', () => {
  assert.deepStrictEqual(runPullRequests({ pullRequests: [pr(FE), pr(BE), pr(FE)] }), [BE, FE]);
});

test('the QA prompt names the ticket, the command and what it must not touch', () => {
  const prompt = qaPrompt('QRD-1286', [BE]);
  assert.match(prompt, /QRD-1286 setelah PR https:/);
  assert.match(prompt, /Agent step" v2 di ~\/\.claude\/kit\/qa-local\/README\.md/);
  assert.match(prompt, /qonflo-qa-local QRD-1286/);
  assert.match(prompt, /Dilarang: menulis ke ~\/qa, UAT, Jira/);
  assert.match(prompt, /deploy-gate\.cjs QRD-1286/);
  assert.match(prompt, /UAT CHECK setelah QA lokal lolos DAN deploy-gate menjawab ready/);
});

const trig = (extra: Partial<QaTrigger> = {}): QaTrigger => ({ prs: [BE, FE], sessionId: 'old', at: '2026-11-04T07:00:00.000Z', error: null, round: 0, fixFor: null, heads: {}, ...extra });

function world(options: { available?: boolean; enabled?: boolean; machine?: string; last?: QaTrigger | null; failOpen?: boolean; run?: QaRun | null; heads?: Record<string, string | null>; failMessage?: boolean } = {}) {
  const saved: Array<{ key: string; trigger: QaTrigger }> = [];
  const opened: Array<{ key: string; prompt: string }> = [];
  const messages: Array<{ key: string; prompt: string }> = [];
  const deps: QaAutoDeps = {
    available: () => options.available ?? true,
    enabled: async () => options.enabled ?? true,
    machine: async () => options.machine ?? 'workspace',
    last: async () => options.last ?? null,
    save: async (key, trigger) => { saved.push({ key, trigger }); },
    open: async (key, prompt) => {
      if (options.failOpen) throw new Error('Turns are full');
      opened.push({ key, prompt });
      return 'session-1';
    },
    now: () => NOW,
    latest: () => options.run ?? null,
    runDir: (key, runId) => `/home/dock/qa-local/runs/${key}/${runId}`,
    head: async (url) => (options.heads ?? {})[url] ?? null,
    message: async (key, prompt) => {
      if (options.failMessage) throw new Error('No session');
      messages.push({ key, prompt });
    },
    tickets: async () => ['QRD-1286'],
  };
  return { auto: new QaAuto(deps), saved, opened, messages };
}

type BuildRun = Parameters<QaAuto['ledger']>[0];
const build = (extra: Partial<BuildRun> = {}): BuildRun => ({ key: 'QRD-1286', kind: 'build', machine: 'workspace', pullRequests: [pr(BE), pr(FE)], updatedAt: '2026-11-04T07:30:00.000Z', ...extra });

test('a build that gets its pull requests starts one QA session and remembers them', async () => {
  const { auto, saved, opened } = world();
  assert.strictEqual(await auto.ledger(build()), true);
  assert.strictEqual(opened.length, 1);
  assert.strictEqual(opened[0].key, 'QRD-1286');
  assert.deepStrictEqual(saved[0].trigger, { prs: [BE, FE], sessionId: 'session-1', at: NOW.toISOString(), error: null, round: 0, fixFor: null, heads: {} });
});

test('the same pull requests do not start QA twice', async () => {
  const { auto, opened } = world({ last: trig({ prs: [BE, FE] }) });
  assert.strictEqual(await auto.ledger(build()), false);
  assert.strictEqual(opened.length, 0);
});

test('a new pull request starts QA again', async () => {
  const { auto, opened } = world({ last: trig({ prs: [BE] }) });
  assert.strictEqual(await auto.ledger(build()), true);
  assert.strictEqual(opened.length, 1);
});

test('nothing starts when the setting is off, the tool is missing, or the run is not a build here with pull requests', async () => {
  for (const [options, run] of [
    [{ enabled: false }, build()],
    [{ available: false }, build()],
    [{ machine: 'laptop' }, build()],
    [{}, build({ kind: 'review' })],
    [{}, build({ pullRequests: [] })],
    [{}, build({ updatedAt: '2026-11-03T20:00:00.000Z' })],
    [{}, build({ key: 'CARD-qa-local' })],
  ] as const) {
    const { auto, opened } = world(options);
    assert.strictEqual(await auto.ledger(run), false);
    assert.strictEqual(opened.length, 0);
  }
});

test('a session that does not start is remembered with its error', async () => {
  const { auto, saved } = world({ failOpen: true });
  assert.strictEqual(await auto.start('QRD-1286', [BE]), false);
  assert.strictEqual(saved[0].trigger.sessionId, null);
  assert.strictEqual(saved[0].trigger.error, 'Turns are full');
});

const RUN_ID = '20261104T073000Z';
const finished = (verdict: string): QaRun => {
  const base = parseProgress(progress({ state: 'done', verdict, startedAt: '2026-11-04T07:30:00.000Z', tcs: [
    { id: 'QRD-1286-TC001', title: 'own avatar', ac: [1, 2], state: 'failed', video: 'videos/QRD-1286-TC001.webm', note: 'avatar missing' },
    { id: 'QRD-1286-TC002', title: 'rename', ac: [3], state: 'passed', video: null, note: null },
  ] }), () => true)!;
  return { ...base, runId: RUN_ID };
};
const HEADS = { [BE]: 'aaa111', [FE]: 'bbb222' };
const DIR = `/home/dock/qa-local/runs/QRD-1286/${RUN_ID}`;

test('a finished REVISION run sends its failed test cases to the Task session once per run', async () => {
  const { auto, saved, messages } = world({ last: trig(), run: finished('REVISION'), heads: HEADS });
  assert.strictEqual(await auto.revision('QRD-1286'), true);
  assert.strictEqual(messages.length, 1);
  const lines = messages[0].prompt.split('\n');
  assert.strictEqual(lines[0], 'QA lokal REVISION QRD-1286 round 1');
  assert.ok(lines.includes(`Folder run: ${DIR}`));
  assert.ok(lines.includes(`summary.md: ${DIR}/summary.md`));
  assert.ok(lines.includes(`- QRD-1286-TC001 | AC 1, 2 | own avatar | catatan: avatar missing | video: ${DIR}/videos/QRD-1286-TC001.webm`));
  assert.ok(!messages[0].prompt.includes('TC002'));
  assert.strictEqual(lines[lines.length - 1], 'Pakai skill sous: perbaiki temuan QA lokal ini lewat light runner di PR yang sama, push ke branch PR, lalu selesai. Jangan buka PR baru.');
  assert.deepStrictEqual(saved[0].trigger, { ...trig(), fixFor: RUN_ID, heads: HEADS });
  const again = world({ last: saved[0].trigger, run: finished('REVISION'), heads: HEADS });
  assert.strictEqual(await again.auto.revision('QRD-1286'), false);
  assert.strictEqual(again.messages.length, 0);
});

test('LOLOS, AC-GAP, ESCALATED, a running run and a run from before the trigger send nothing', async () => {
  for (const run of [finished('LOLOS'), finished('AC-GAP'), finished('ESCALATED'), { ...finished('REVISION'), state: 'running' as const }, { ...finished('REVISION'), startedAt: '2026-11-04T06:00:00.000Z' }, null]) {
    const { auto, messages } = world({ last: trig(), run, heads: HEADS });
    assert.strictEqual(await auto.revision('QRD-1286'), false);
    assert.strictEqual(messages.length, 0);
  }
});

test('a REVISION at round 2 sends nothing', async () => {
  const { auto, messages } = world({ last: trig({ round: 2 }), run: finished('REVISION'), heads: HEADS });
  assert.strictEqual(await auto.revision('QRD-1286'), false);
  assert.strictEqual(messages.length, 0);
});

test('a head SHA GitHub cannot give or a message that fails is not recorded', async () => {
  const noHead = world({ last: trig(), run: finished('REVISION'), heads: { [BE]: 'aaa111' } });
  assert.strictEqual(await noHead.auto.revision('QRD-1286'), false);
  assert.strictEqual(noHead.messages.length, 0);
  const failing = world({ last: trig(), run: finished('REVISION'), heads: HEADS, failMessage: true });
  await assert.rejects(failing.auto.revision('QRD-1286'), /No session/);
  assert.strictEqual(failing.saved.length, 0);
});

test('the tick looks at each ticket for a REVISION run, and only while QA is on', async () => {
  const { auto, messages } = world({ last: trig(), run: finished('REVISION'), heads: HEADS });
  await auto.tick();
  assert.strictEqual(messages.length, 1);
  const off = world({ enabled: false, last: trig(), run: finished('REVISION'), heads: HEADS });
  await off.auto.tick();
  assert.strictEqual(off.messages.length, 0);
});

test('QA runs again, one round on, only after a pull request head changed since the fix message', async () => {
  const waiting = trig({ fixFor: RUN_ID, heads: HEADS });
  const same = world({ last: waiting, heads: HEADS });
  assert.strictEqual(await same.auto.ledger(build()), false);
  assert.strictEqual(same.opened.length, 0);
  const moved = world({ last: waiting, heads: { [BE]: 'aaa111', [FE]: 'ccc333' } });
  assert.strictEqual(await moved.auto.ledger(build()), true);
  assert.strictEqual(moved.opened.length, 1);
  assert.deepStrictEqual(moved.saved[0].trigger, { prs: [BE, FE], sessionId: 'session-1', at: NOW.toISOString(), error: null, round: 1, fixFor: null, heads: {} });
  const unknown = world({ last: waiting, heads: {} });
  assert.strictEqual(await unknown.auto.ledger(build()), false);
  assert.strictEqual(unknown.opened.length, 0);
});

test('a trigger cached before fix rounds existed reads with the defaults', async () => {
  const old = { prs: [BE], sessionId: 's1', at: '2026-11-04T07:00:00.000Z', error: null };
  assert.deepStrictEqual(readTrigger(old), { ...old, round: 0, fixFor: null, heads: {} });
  assert.strictEqual(readTrigger(null), null);
  const { auto, opened } = world({ last: old as unknown as QaTrigger });
  assert.strictEqual(await auto.ledger(build({ pullRequests: [pr(BE)] })), false);
  assert.strictEqual(opened.length, 0);
  assert.match(revisionPrompt('QRD-1', 2, finished('REVISION'), '/d'), /^QA lokal REVISION QRD-1 round 2\n/);
});
