import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendScout, contextOf, createGm, createLedger, loadScenarios, partyOf, png, scoutLine, selectScenario, withParty, writeTranscripts } from './bridge-lib.mjs';
import { bridgeConfig, createBridge } from './fake-bridge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const scenarios = loadScenarios(path.join(HERE, 'scenarios'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fake-bridge-'));
const DOCK_SCOUT_LINE = /^(?:Scout:\s*)?(.+?)\s+·\s+~?(\d+)\s+files?\s+·\s+(no contract change|contract change)\b[^→]*?\s*(?:→|->)\s*(light|full)\s*$/i;
const dockMacValid = (key, row) => {
  const expected = crypto.createHmac('sha256', key).update(JSON.stringify({ ...row, mac: undefined })).digest('hex');
  return typeof row.mac === 'string' && crypto.timingSafeEqual(Buffer.from(row.mac), Buffer.from(expected));
};
const pick = (msg, boardRoot = tmp()) => {
  const ctx = contextOf(msg, { boardRoot });
  return { ctx, name: selectScenario(scenarios, ctx)?.name };
};

test('every scenario file loads with a name and turns', () => {
  const names = scenarios.map((s) => s.name);
  for (const name of ['task-full', 'task-light', 'review', 'review-findings', 'scout', 'guild-master', 'guild-master-confirm', 'judge', 'plan', 'chat']) assert.ok(names.includes(name), name);
});

test('a sous start picks task-full, and task-light once the Contract has a light Party', () => {
  const text = 'Pakai skill sous: kerjakan QRD-9001. Cron run: no GATE 1; work through to an opened pull request.';
  assert.equal(pick({ id: 1, sessionId: 's1', text }).name, 'task-full');
  const boardRoot = tmp();
  fs.mkdirSync(path.join(boardRoot, 'QRD-9002', 'materials'), { recursive: true });
  fs.writeFileSync(path.join(boardRoot, 'QRD-9002', 'materials', 'contract.md'), '# Contract\n\n## Party\nmode: light\nworker: sous-ticket-worker (sonnet)\nby: Guild Master, log #1\n');
  const light = pick({ id: 2, sessionId: 's2', text: 'Pakai skill sous: kerjakan QRD-9002.' }, boardRoot);
  assert.equal(light.name, 'task-light');
  assert.equal(light.ctx.vars.partyMode, 'light');
});

test('review, findings round, scout, judge, plan and chat prompts pick their scenario', () => {
  const review = pick({ id: 3, sessionId: 's3', text: 'Pakai skill sous. review QRD-9005: https://github.com/qonflo-e2e/ms-admin-worker-backend/pull/77\nThread Discord pr-review: https://discord.com/channels/1/2' });
  assert.equal(review.name, 'review');
  assert.equal(review.ctx.vars.key, 'QRD-9005');
  assert.equal(review.ctx.vars.prRepo, 'qonflo-e2e/ms-admin-worker-backend');
  assert.equal(review.ctx.vars.prNumber, '77');
  const findings = pick({ id: 4, sessionId: 's4', text: 'Pakai skill sous. Jalankan sous-light-runner untuk round ini di tiket QRD-9001 (source findings), dari blackboard.\nLight settings: lines=150 files=3 worker=sonnet browser=on blast=on loops=2 publish=push\nTemuan review baru dari thread Discord pr-review: https://discord.com/channels/1/2 (round rf-abc123).\nPR: https://github.com/qonflo-e2e/ms-admin-worker-backend/pull/9001' });
  assert.equal(findings.name, 'review-findings');
  assert.equal(findings.ctx.vars.roundId, 'rf-abc123');
  assert.match(findings.ctx.vars.lightSettings, /^lines=150/);
  const scout = pick({ id: 5, sessionId: 's5', text: 'SCOUT QRD-9003, read only. Dispatch the sous-explorer agent (sonnet) with a SCOUT task for QRD-9003: BOARD=/tmp/bb/QRD-9003, the findings' });
  assert.equal(scout.name, 'scout');
  assert.equal(scout.ctx.vars.board, '/tmp/bb/QRD-9003');
  assert.equal(pick({ id: 6, sessionId: 's6', title: 'Judge-x', text: 'Pakai skill judge: session abc-1 input /x/in.md until 12' }).name, 'judge');
  const plan = pick({ id: 7, sessionId: 's7', text: 'Pakai skill sous: plan Sprint 30.\nSprint plan run: read only. No branch, no code, no Jira edits, no ledger.\nOwner tickets to order: QRD-9001, QRD-9002. Other tickets of the sprint' });
  assert.equal(plan.name, 'plan');
  assert.equal(plan.ctx.vars.ownerKeys, 'QRD-9001, QRD-9002');
  assert.equal(pick({ id: 8, sessionId: 's8', text: 'halo' }).name, 'chat');
});

test('Guild Master turns pick propose, confirm or plain chat', () => {
  assert.equal(pick({ id: 9, sessionId: 'g1', mode: 'gm', text: 'Bentuk Party QRD-9002 mode light' }).name, 'guild-master');
  assert.equal(pick({ id: 10, sessionId: 'g1', mode: 'gm', text: 'ya', gmConfirm: { nonce: 'n', sha256: 'x', exp: 1 } }).name, 'guild-master-confirm');
  assert.equal(pick({ id: 11, sessionId: 'g1', mode: 'gm', text: 'apa kabar' }).name, 'guild-master-chat');
});

test('the ledger writer keeps the status.cjs layout and renders status.md', () => {
  const root = tmp();
  const ledger = createLedger({ evidenceRoot: root, boardRoot: path.join(root, 'blackboard') });
  ledger.apply('QRD-9001', { op: 'init', title: 'E2E' });
  ledger.apply('QRD-9001', { op: 'set', values: { engine: 'sous', mode: 'light', stage: 'code', 'pr.be': 'https://github.com/o/r/pull/1' } });
  ledger.apply('QRD-9001', { op: 'dispatch', agent: 'sous-ticket-worker', model: 'sonnet', step: 'light-work' });
  ledger.apply('QRD-9001', { op: 'finding', severity: 'blocker', text: 'crash' });
  assert.throws(() => ledger.apply('QRD-9001', { op: 'verdict', value: 'approve' }), /unresolved blocker/);
  ledger.apply('QRD-9001', { op: 'findingResolve', n: 1, why: 'fixed' });
  ledger.apply('QRD-9001', { op: 'verdict', value: 'approve' });
  const s = JSON.parse(fs.readFileSync(path.join(root, 'QRD-9001', 'status.json'), 'utf8'));
  assert.equal(s.key, 'QRD-9001');
  assert.equal(s.stage, 'code');
  assert.equal(s.mode, 'light');
  assert.deepEqual(s.pr, { be: 'https://github.com/o/r/pull/1' });
  assert.deepEqual(s.history.map((h) => [h.from, h.to]), [['gate', 'code']]);
  assert.deepEqual({ ...s.dispatches[0], at: undefined }, { at: undefined, agent: 'sous-ticket-worker', model: 'sonnet', step: 'light-work', mode: 'light' });
  assert.equal(s.findings[0].resolved.why, 'fixed');
  assert.deepEqual(s.verdict.prs, ['https://github.com/o/r/pull/1']);
  assert.equal(s.blackboard, path.join(root, 'blackboard', 'QRD-9001').replace(/\\/g, '/'));
  const md = fs.readFileSync(path.join(root, 'blackboard', 'QRD-9001', 'status.md'), 'utf8');
  assert.match(md, /^<!-- generated, do not edit/);
  assert.match(md, /# Status - QRD-9001 · E2E/);
  assert.match(md, /· STAGE · gate -> code/);
  assert.match(md, /· FINDING-RESOLVED · #1: fixed/);
  for (const f of ['NOW.md', 'decisions.md', 'issues.md']) assert.ok(fs.existsSync(path.join(root, 'blackboard', 'QRD-9001', f)), f);
});

test('the Scout line DOCK parses is appended to contract.md', () => {
  const file = path.join(tmp(), 'QRD-9003', 'materials', 'contract.md');
  const lineText = scoutLine({ repos: 'FE', files: 1, contract: 'no contract change', verdict: 'light' });
  appendScout(file, lineText);
  appendScout(file, scoutLine({ repos: 'BE + FE', files: 4, contract: 'contract change', verdict: 'full' }));
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const m = DOCK_SCOUT_LINE.exec(lines[0]);
  assert.deepEqual([m[1], m[2], m[3], m[4]], ['FE', '1', 'no contract change', 'light']);
  assert.equal(DOCK_SCOUT_LINE.exec(lines[1])[4], 'full');
});

test('a Party proposal, its confirmed write and the rollback follow gm.cjs', async () => {
  const root = tmp();
  const boardRoot = path.join(root, 'blackboard');
  const gm = createGm({ stateDir: path.join(root, 'state'), boardRoot });
  appendScout(path.join(boardRoot, 'QRD-9002', 'materials', 'contract.md'), scoutLine({ repos: 'FE', files: 1, contract: 'no contract change', verdict: 'light' }));
  const change = gm.proposeParty('sess-1', 'QRD-9002', { mode: 'light', worker: 'sonnet' });
  assert.match(change.diff, /^contract > Party \(QRD-9002\)/);
  assert.match(change.diff, /\+ mode: light/);
  const raw = gm.pendingRaw('sess-1');
  const confirms = [];
  const confirm = async (body) => { confirms.push(body); return { ok: true }; };
  const wrong = await gm.apply({ sessionId: 'sess-1', gmConfirm: { nonce: 'n1', sha256: 'bad', exp: Date.now() + 60000 }, key: 'k', confirm });
  assert.equal(wrong.ok, false);
  gm.proposeParty('sess-1', 'QRD-9002', { mode: 'light', worker: 'sonnet' });
  const sha = crypto.createHash('sha256').update(gm.pendingRaw('sess-1')).digest('hex');
  assert.equal(raw.length > 0, true);
  const r = await gm.apply({ sessionId: 'sess-1', gmConfirm: { nonce: 'n2', sha256: sha, exp: Date.now() + 60000 }, key: 'log-key', confirm });
  assert.equal(r.ok, true);
  assert.deepEqual(confirms, [{ sessionId: 'sess-1', nonce: 'n2', sha256: sha }]);
  assert.ok(dockMacValid('log-key', r.entry));
  const contract = fs.readFileSync(gm.contractFile('QRD-9002'), 'utf8');
  assert.deepEqual(partyOf(contract).lines, ['mode: light', 'worker: sous-ticket-worker (sonnet)', `by: Guild Master, log #${r.entry.id}`]);
  assert.match(contract, /^Scout: FE/m);
  const view = gm.view('log-key');
  assert.equal(view[0].unverified, false);
  assert.equal(view[0].type, 'party');
  assert.equal(view[0].mac, undefined);
  const back = await gm.rollback({ id: r.entry.id, key: 'log-key', nonce: 'n3', confirm });
  assert.equal(back.ok, true);
  assert.deepEqual(confirms[1], { sessionId: null, nonce: 'n3', sha256: `rollback:${r.entry.id}` });
  assert.equal(partyOf(fs.readFileSync(gm.contractFile('QRD-9002'), 'utf8')), null);
  assert.equal(gm.view('log-key').find((e) => e.id === r.entry.id).rolledBack, true);
  assert.equal((await gm.rollback({ id: r.entry.id, key: 'log-key', nonce: 'n4', confirm })).ok, false);
});

test('withParty keeps every other line', () => {
  const text = 'a\r\nb\r\n';
  const once = withParty(text, ['mode: full']);
  assert.equal(once, 'a\r\nb\r\n\r\n## Party\r\nmode: full\r\n');
  assert.equal(withParty(once, null), 'a\r\nb\r\n\r\n');
});

test('png writes a real PNG and transcripts carry agentType for the per-agent rows', () => {
  const bytes = png(8, 4);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(bytes.readUInt32BE(16), 8);
  const dir = writeTranscripts({ configDir: tmp(), project: 'p', claudeSessionId: 'abc', mainTokens: 1000, agents: [{ id: 'a1', type: 'sous-verifier', model: 'sonnet', tokens: 500 }] });
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'abc', 'subagents', 'agent-a1.meta.json'), 'utf8'));
  assert.equal(meta.agentType, 'sous-verifier');
  const rows = fs.readFileSync(path.join(dir, 'abc', 'subagents', 'agent-a1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const total = rows.reduce((n, r) => n + r.message.usage.input_tokens + r.message.usage.cache_read_input_tokens + r.message.usage.output_tokens, 0);
  assert.equal(total, 500);
  assert.ok(fs.existsSync(path.join(dir, 'abc.jsonl')));
});

function fakeServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url === '/__script' ? { ok: true, results: [{ sha: 'abcdef1234567890abcdef1234567890abcdef12' }] } : { ok: true, result: { ok: true } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

test('a task turn posts ledgers, events, deltas, status and the mock script', async () => {
  const { server, calls, url } = await fakeServer();
  try {
    const e2eDir = tmp();
    const cfg = bridgeConfig({ E2E_DIR: e2eDir, DOCK_URL: url, DOCK_MOCK_URL: url, DOCK_INGEST_TOKEN: 'tok', E2E_STEP_MS: '0' });
    const bridge = createBridge(cfg, { sleep: async () => {} });
    await bridge.runTurn({ id: 41, sessionId: 'sess-task', text: 'Pakai skill sous: kerjakan QRD-9001.' });
    const routes = calls.map((c) => c.url);
    assert.ok(routes.includes('/ingest/orchestrator'));
    assert.ok(routes.includes('/ingest/orchestrator/events'));
    assert.ok(routes.includes('/ingest/orchestrator/chat/status'));
        assert.ok(calls.filter((c) => c.url.startsWith('/ingest')).every((c) => c.auth === 'Bearer tok'));
    const deltas = calls.filter((c) => c.url === '/ingest/orchestrator/chat/delta').map((c) => c.body);
    assert.equal(deltas.at(-1).done, true);
    assert.ok(deltas.every((d) => d.replyTo === 41 && /^[0-9a-f-]{36}$/.test(d.claudeSessionId)));
    const ledgerPush = calls.filter((c) => c.url === '/ingest/orchestrator').at(-1).body;
    assert.equal(ledgerPush.stage, 'pr');
    assert.equal(ledgerPush.pr.fe, 'https://github.com/qonflo/dashboard/pull/101');
    const events = calls.filter((c) => c.url === '/ingest/orchestrator/events').flatMap((c) => c.body.events);
    assert.ok(events.some((e) => e.event === 'SubagentStop' && e.agentType === 'sous-planner'));
    assert.equal(events.at(-1).event, 'Stop');
    const subagents = path.join(e2eDir, 'claude', 'projects', 'e2e-workspace', deltas[0].claudeSessionId, 'subagents');
    assert.equal(fs.readdirSync(subagents).filter((f) => f.endsWith('.meta.json')).length, 5);
    assert.match(fs.readFileSync(path.join(e2eDir, 'bridge.log'), 'utf8'), /scenario=task-full/);
  } finally { server.close(); }
});

test('a review turn ends with the DISCORD block and a screenshot on the board', async () => {
  const { server, calls, url } = await fakeServer();
  try {
    const e2eDir = tmp();
    const later = [];
    const bridge = createBridge(bridgeConfig({ E2E_DIR: e2eDir, DOCK_URL: url, DOCK_MOCK_URL: url, DOCK_INGEST_TOKEN: 'tok', E2E_STEP_MS: '0' }), { sleep: async () => {}, schedule: (ms, work) => later.push({ ms, work }) });
    await bridge.runTurn({ id: 50, sessionId: 'sess-rev', text: 'Pakai skill sous. review QRD-9005: https://github.com/qonflo-e2e/ms-admin-worker-backend/pull/77' });
    const said = calls.filter((c) => c.url === '/ingest/orchestrator/chat/delta').flatMap((c) => c.body.items).filter((i) => i.role === 'assistant').at(-1).text;
    assert.match(said, /<<<DISCORD\n[\s\S]*GAMBAR: review-empty-state\.png\n<<<AKHIR DISCORD>>>/);
    assert.ok(fs.existsSync(path.join(e2eDir, 'evidence', 'QRD-9005', 'screenshots', 'review-empty-state.png')));
    const ledgerPush = calls.filter((c) => c.url === '/ingest/orchestrator').at(-1).body;
    assert.equal(ledgerPush.kind, 'review');
    assert.equal(ledgerPush.verdict.value, 'request-change');
    assert.equal(later.length, 1);
    await later[0].work();
    const scripts = calls.filter((c) => c.url === '/__script').map((c) => c.body);
    assert.deepEqual(scripts.map((x) => x.action), ['pushCommit', 'addMessage']);
    assert.equal(scripts[0].pr, 'https://github.com/qonflo-e2e/ms-admin-worker-backend/pull/77');
    assert.equal(scripts[1].thread, 'QRD-9005');
    assert.match(scripts[1].text, /DOCK-FIX round 1 · head abcdef1$/);
  } finally { server.close(); }
});

test('a Guild Master proposal, the owner ya and a panel rollback go through DOCK routes', async () => {
  const { server, calls, url } = await fakeServer();
  try {
    const e2eDir = tmp();
    const bridge = createBridge(bridgeConfig({ E2E_DIR: e2eDir, DOCK_URL: url, DOCK_MOCK_URL: url, DOCK_INGEST_TOKEN: 'tok', E2E_STEP_MS: '0' }), { sleep: async () => {} });
    await bridge.runTurn({ id: 60, sessionId: 'gm-sess', mode: 'gm', text: 'Bentuk Party QRD-9002 mode light' });
    const proposal = calls.find((c) => c.url === '/ingest/orchestrator/chat/gm/proposal').body;
    assert.equal(proposal.replyTo, 60);
    const doneAt = calls.findIndex((c) => c.url === '/ingest/orchestrator/chat/delta' && c.body.done);
    assert.ok(doneAt < calls.findIndex((c) => c.url === '/ingest/orchestrator/chat/gm/proposal'));
    const sha = crypto.createHash('sha256').update(proposal.pending).digest('hex');
    await bridge.runTurn({ id: 61, sessionId: 'gm-sess', mode: 'gm', text: 'ya', gmConfirm: { nonce: 'n1', sha256: sha, exp: Date.now() + 60000 }, gmKey: 'log-key' });
    assert.deepEqual(calls.find((c) => c.url === '/ingest/orchestrator/chat/gm/confirm').body, { sessionId: 'gm-sess', nonce: 'n1', sha256: sha });
    const said = calls.filter((c) => c.url === '/ingest/orchestrator/chat/delta').flatMap((c) => c.body.items).filter((i) => i.role === 'assistant').at(-1).text;
    assert.match(said, /^\[DOCK\] DOCK wrote the pending change: manager log #1, backup .+\.bak\.$/);
    assert.equal(partyOf(fs.readFileSync(path.join(e2eDir, 'evidence', 'QRD-9002', 'materials', 'contract.md'), 'utf8')).mode, 'light');
    await bridge.runJob({ id: 'job-1', op: 'gm-log', input: { key: 'log-key' } });
    const logResult = calls.filter((c) => c.url === '/ingest/orchestrator/chat/agents/result').at(-1).body;
    assert.equal(logResult.result[0].unverified, false);
    assert.deepEqual(logResult.result[0].party, ['mode: light', 'worker: sous-ticket-worker (sonnet)', 'by: Guild Master, log #1']);
    await bridge.runJob({ id: 'job-2', op: 'gm-rollback', input: { id: 1, key: 'log-key', nonce: 'n2' } });
    const rollback = calls.filter((c) => c.url === '/ingest/orchestrator/chat/agents/result').at(-1).body;
    assert.equal(rollback.result.ok, true);
    assert.equal(rollback.result.entry.rollbackOf, 1);
    assert.deepEqual(calls.filter((c) => c.url === '/ingest/orchestrator/chat/gm/confirm').at(-1).body, { sessionId: null, nonce: 'n2', sha256: 'rollback:1' });
  } finally { server.close(); }
});

test('the bridge exits 2 with a clear message when DOCK is down', () => {
  const e2eDir = tmp();
  const r = spawnSync(process.execPath, [path.join(HERE, 'fake-bridge.mjs')], { env: { ...process.env, E2E_DIR: e2eDir, DOCK_URL: 'http://127.0.0.1:9', DOCK_INGEST_TOKEN: 'tok', BRIDGE_READY_MS: '300' }, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /fake-bridge: DOCK is not ready: .*unreachable/);
  assert.match(fs.readFileSync(path.join(e2eDir, 'bridge.log'), 'utf8'), /FATAL/);
});

test('the bridge exits 2 without a token', () => {
  const r = spawnSync(process.execPath, [path.join(HERE, 'fake-bridge.mjs')], { env: { ...process.env, E2E_DIR: tmp(), DOCK_INGEST_TOKEN: '' }, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no ingest token/);
});
