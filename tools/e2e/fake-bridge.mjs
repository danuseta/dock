#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendScout, contextOf, createGm, createLedger, fill, loadScenarios, png, scoutLine, selectScenario, uuidFrom, writeTranscripts } from './bridge-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_STEP_MS = 2000;
const CLAIM_WAIT_S = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bridgeConfig(env = process.env) {
  const e2eDir = env.E2E_DIR || path.join(os.tmpdir(), 'dock-e2e');
  const evidence = path.join(e2eDir, 'evidence');
  const dockUrl = (env.DOCK_URL || 'http://localhost:4710').replace(/\/+$/, '');
  let token = env.DOCK_INGEST_TOKEN || '';
  if (!token) try { token = fs.readFileSync(path.join(e2eDir, 'token'), 'utf8').trim(); } catch { token = ''; }
  return {
    e2eDir,
    evidence,
    boardRoot: env.DOCK_BLACKBOARD_DIR || evidence,
    seedFile: path.join(e2eDir, 'seed.json'),
    stateDir: path.join(e2eDir, 'kit-state'),
    claudeDir: env.E2E_CLAUDE_DIR || path.join(e2eDir, 'claude'),
    project: env.E2E_CLAUDE_PROJECT || 'e2e-workspace',
    ingest: (env.DOCK_INGEST_URL || `${dockUrl}/ingest/orchestrator`).replace(/\/+$/, ''),
    mockUrl: (env.DOCK_MOCK_URL || 'http://localhost:4610').replace(/\/+$/, ''),
    scenarioDir: env.SCENARIO_DIR || path.join(HERE, 'scenarios'),
    token,
    stepMs: Math.min(MAX_STEP_MS, Math.max(0, Number(env.E2E_STEP_MS ?? 400))),
    readyMs: Math.max(0, Number(env.BRIDGE_READY_MS ?? 20000)),
    parallel: Math.max(1, Number(env.E2E_PARALLEL) || 3),
    logFile: path.join(e2eDir, 'bridge.log'),
  };
}

class DockError extends Error {}

export function createBridge(cfg, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), schedule = (ms, work) => setTimeout(work, ms) } = {}) {
  const ledger = createLedger({ evidenceRoot: cfg.evidence, boardRoot: cfg.boardRoot });
  const gm = createGm({ stateDir: cfg.stateDir, boardRoot: cfg.boardRoot });
  const scenarios = loadScenarios(cfg.scenarioDir);
  const stateFile = path.join(cfg.e2eDir, 'bridge-state.json');
  const log = (line) => {
    const row = `${new Date().toISOString()} ${line}`;
    fs.mkdirSync(path.dirname(cfg.logFile), { recursive: true });
    fs.appendFileSync(cfg.logFile, `${row}\n`);
    process.stdout.write(`${row}\n`);
  };

  async function post(url, body, timeoutMs, headers = {}) {
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new DockError(`${url} unreachable: ${e.cause?.code || e.message}`);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new DockError(`${url} answered ${res.status}${json.error ? `: ${json.error}` : ''}`);
    return json;
  }
  const dock = async (route, body, timeoutMs = 15000) => (await post(`${cfg.ingest}${route}`, body, timeoutMs, { authorization: `Bearer ${cfg.token}` })).result;
  async function mock(body) {
    const r = await post(`${cfg.mockUrl}/__script`, body, 15000);
    const failed = (r.results || []).find((x) => x && x.error);
    if (failed) throw new DockError(`mock script ${body.action} failed: ${failed.error}`);
    return (r.results || [])[0] || {};
  }
  const seed = () => { try { return JSON.parse(fs.readFileSync(cfg.seedFile, 'utf8')); } catch { return {}; } };

  const counts = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
  function nextCount(id) {
    const all = counts();
    const n = all[id] ?? 0;
    all[id] = n + 1;
    fs.mkdirSync(cfg.e2eDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(all, null, 2));
    return n;
  }

  const pushLedger = async (key) => { const s = ledger.load(key); if (s) await dock('', s); };
  const events = (key, list) => dock('/events', { key, events: list.map((e) => ({ at: new Date().toISOString(), ...e })) });

  async function runTurn(msg) {
    const ctx = contextOf(msg, { boardRoot: cfg.boardRoot });
    const vars = { ...Object.fromEntries(Object.entries(seed()).filter(([, v]) => typeof v === 'string')), ...ctx.vars, gmNote: '' };
    if (ctx.mode === 'gm') {
      if (msg.gmConfirm) {
        const r = await gm.apply({ sessionId: msg.sessionId, gmConfirm: msg.gmConfirm, key: msg.gmKey, confirm: (body) => dock('/chat/gm/confirm', body) });
        vars.gmNote = r.ok ? `[DOCK] DOCK wrote the pending change: manager log #${r.entry.id}, backup ${r.entry.backup}.` : `[DOCK] DOCK wrote nothing: ${r.error}.`;
        vars.gmLog = r.ok ? String(r.entry.id) : '';
      } else gm.discard(msg.sessionId);
    }
    const scenario = selectScenario(scenarios, ctx);
    if (!scenario) throw new Error(`no scenario matches message ${msg.id}: ${ctx.text.slice(0, 120)}`);
    const n = nextCount(`${scenario.name}|${vars.key || msg.sessionId}`);
    const turn = scenario.turns[Math.min(n, scenario.turns.length - 1)];
    Object.assign(vars, fill((scenario.byKey || {})[vars.key] || (scenario.byKey || {})['*'] || {}, vars));
    const sha = crypto.createHash('sha1').update(`${msg.sessionId}:${msg.id}`).digest('hex');
    Object.assign(vars, { n: String(n), sha, shortSha: sha.slice(0, 7) });
    log(`turn session=${msg.sessionId} message=${msg.id} mode=${ctx.mode} scenario=${scenario.name} turn=${Math.min(n, scenario.turns.length - 1)} key=${vars.key || '-'}`);

    const claudeSessionId = UUID.test(String(msg.claudeSessionId || '')) ? msg.claudeSessionId : uuidFrom(msg.sessionId);
    const pushMode = scenario.ledgerPush === 'end' ? 'end' : 'step';
    const touched = new Set();
    const agents = [];
    let items = [];
    let detail = null;
    const flush = async (extra = {}) => {
      const body = { sessionId: msg.sessionId, replyTo: msg.id, items, claudeSessionId, ...(detail ? { detail } : {}), done: false, error: null, ...extra };
      items = [];
      await dock('/chat/delta', body);
    };
    const say = (role, text) => items.push({ role, text, at: new Date().toISOString() });
    const keyOf = (s) => s.key || vars.key;

    for (const [index, raw] of (turn.steps || []).entries()) {
      await sleep(Math.min(MAX_STEP_MS, raw.delayMs ?? cfg.stepMs));
      const step = fill(raw, vars);
      if (step.say !== undefined) say('assistant', step.say);
      else if (step.tool) { say('tool', `${step.tool} · ${step.text || ''}`.trim()); detail = step.tool; }
      else if (step.ledger) {
        const key = keyOf(step.ledger);
        ledger.apply(key, step.ledger);
        touched.add(key);
        say('tool', `Bash · node status.cjs ${step.ledger.op} ${key}`);
        detail = 'Bash';
        if (pushMode === 'step') { await pushLedger(key); await events(key, [{ event: 'PreToolUse', tool: 'Bash' }]); }
      } else if (step.agent) {
        const a = step.agent;
        const key = keyOf(a);
        const id = crypto.createHash('sha1').update(`${msg.sessionId}:${msg.id}:${index}`).digest('hex').slice(0, 17);
        agents.push({ id, type: a.type, model: a.model || 'sonnet', tokens: Number(a.tokens) || 20000, detail: a.detail });
        say('tool', `Agent · ${a.detail || a.type}`);
        detail = 'Agent';
        if (key && ledger.load(key)) {
          ledger.apply(key, { op: 'dispatch', agent: a.type, model: a.model || 'sonnet', step: a.step });
          touched.add(key);
          if (pushMode === 'step') {
            await pushLedger(key);
            await events(key, [
              { event: 'PreToolUse', tool: 'Agent', spawnType: a.type, detail: String(a.detail || a.type).slice(0, 60) },
              { event: 'PreToolUse', tool: 'Bash', agentId: id, agentType: a.type },
            ]);
            await sleep(Math.min(MAX_STEP_MS, cfg.stepMs));
            await events(key, [{ event: 'SubagentStop', agentId: id, agentType: a.type }]);
          }
        }
      } else if (step.file) {
        const file = path.join(ledger.boardDir(keyOf(step.file)), step.file.path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, step.file.text);
      } else if (step.scout) {
        const lineText = scoutLine(step.scout);
        appendScout(path.join(vars.board, 'materials', 'contract.md'), lineText);
        vars.scoutLine = lineText;
        say('tool', `Bash · append Scout line to ${vars.board}/materials/contract.md`);
      } else if (step.screenshot) {
        const file = path.join(ledger.boardDir(keyOf(step)), 'screenshots', step.screenshot);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, png());
      } else if (step.script) {
        const r = await mock(step.script);
        if (typeof r.sha === 'string') Object.assign(vars, { sha: r.sha, shortSha: r.sha.slice(0, 7) });
        log(`script ${JSON.stringify(step.script).slice(0, 200)} -> ${JSON.stringify(r).slice(0, 200)}`);
      } else if (step.gm) {
        const change = gm.proposeParty(msg.sessionId, step.gm.key || vars.key, { mode: step.gm.mode, worker: step.gm.worker });
        vars.gmDiff = change.diff;
        vars.gmSummary = change.summary;
        say('tool', `Bash · node gm.cjs propose-party ${change.key} --mode ${change.mode}`);
      } else if (step.judge) {
        await dock('/judge', { sessionId: vars.judgeSession, untilMessageId: vars.judgeUntil || '-', findings: step.judge.findings || [], ownerWaitMinutes: 0 });
      } else if (step.plan) {
        const keys = String(vars.ownerKeys || '').split(/,\s*/).filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k));
        await dock('/plan', { sprint: vars.sprint, mode: 'full', tickets: keys, order: keys, groups: [keys], edges: step.plan.edges || [] });
      } else if (step.set) Object.assign(vars, step.set);
      else if (step.wait === undefined) throw new Error(`scenario ${scenario.name}: unknown step ${JSON.stringify(raw).slice(0, 120)}`);
      if (items.length || detail) await flush();
    }

    detail = null;
    await sleep(Math.min(MAX_STEP_MS, cfg.stepMs));
    await flush({ done: true });
    const model = turn.model || 'sonnet';
    const mainTokens = Number(turn.tokens) || 30000;
    writeTranscripts({ configDir: cfg.claudeDir, project: cfg.project, claudeSessionId, mainModel: model, mainTokens, agents });
    await dock('/chat/status', { sessionId: msg.sessionId, model, contextTokens: mainTokens, contextSize: 200000, contextPercentage: Math.round((mainTokens / 200000) * 1000) / 10, turnCostUsd: Number(turn.costUsd ?? 0.12), files: [] });
    for (const key of touched) {
      await pushLedger(key);
      if (pushMode === 'end') {
        await events(key, agents.flatMap((a) => [
          { event: 'PreToolUse', tool: 'Agent', spawnType: a.type, detail: String(a.detail || a.type).slice(0, 60) },
          { event: 'PreToolUse', tool: 'Bash', agentId: a.id, agentType: a.type },
          { event: 'SubagentStop', agentId: a.id, agentType: a.type },
        ]).concat([{ event: 'PreToolUse', tool: 'Bash' }]));
      }
      await events(key, [{ event: 'Stop' }]);
    }
    if (ctx.mode === 'gm') {
      const pending = gm.pendingRaw(msg.sessionId);
      if (pending) {
        const r = await dock('/chat/gm/proposal', { sessionId: msg.sessionId, replyTo: msg.id, pending });
        log(`gm proposal for ${msg.sessionId}: ${JSON.stringify(r)}`);
      }
    }
    const after = turn.after || [];
    if (after.length) schedule(0, () => (async () => {
      for (const later of after) {
        await sleep(Math.max(0, Number(later.delayMs) || 0));
        const step = fill(later, vars);
        const r = await mock(step.script);
        if (typeof r.sha === 'string') Object.assign(vars, { sha: r.sha, shortSha: r.sha.slice(0, 7) });
        log(`after-script ${JSON.stringify(step.script).slice(0, 200)} -> ${JSON.stringify(r).slice(0, 200)}`);
      }
    })().catch((e) => fatal(e)));
    log(`done session=${msg.sessionId} message=${msg.id} scenario=${scenario.name}`);
  }

  async function runJob(job) {
    let body;
    try {
      const input = job.input && typeof job.input === 'object' ? job.input : {};
      if (job.op === 'gm-log') body = { id: job.id, result: gm.view(input.key).slice(0, 100) };
      else if (job.op === 'gm-rollback') body = { id: job.id, result: await gm.rollback({ id: input.id, key: input.key, nonce: input.nonce, confirm: (b) => dock('/chat/gm/confirm', b) }) };
      else if (job.op === 'list') body = { id: job.id, result: [] };
      else body = { id: job.id, error: `The e2e bridge does not run agent op ${String(job.op).slice(0, 40)}` };
    } catch (e) {
      if (e instanceof DockError) throw e;
      body = { id: job.id, error: String(e.message || e).slice(0, 500) };
    }
    log(`job ${job.op} ${job.id} -> ${body.error ? `error ${body.error}` : 'ok'}`);
    await dock('/chat/agents/result', body);
  }

  async function waitReady() {
    const end = Date.now() + cfg.readyMs;
    for (;;) {
      try { return await dock('/chat/settings', {}, 5000); } catch (e) {
        if (!/unreachable/.test(e.message) || Date.now() >= end) throw new DockError(`DOCK is not ready: ${e.message}`);
        await sleep(500);
      }
    }
  }

  let fatal = (e) => { throw e; };
  async function run({ once = false } = {}) {
    if (!cfg.token) throw new DockError(`no ingest token: set DOCK_INGEST_TOKEN or write ${path.join(cfg.e2eDir, 'token')}`);
    await waitReady();
    log(`bridge ready: ${cfg.ingest} scenarios=${scenarios.map((s) => s.name).join(',')}`);
    const running = new Set();
    let failure = null;
    fatal = (e) => { failure = failure || e; };
    const caps = { v: 2, kit: 'dock-kit-2', claude: 'e2e-fake', features: ['agents', 'gm'], modes: [], catalogHash: null };
    for (;;) {
      if (failure) throw failure;
      while (running.size >= cfg.parallel) await Promise.race(running);
      if (failure) throw failure;
      const r = await dock('/chat/claim', { wait: once ? 2 : CLAIM_WAIT_S, caps }, (CLAIM_WAIT_S + 10) * 1000);
      for (const job of r?.agentJobs || []) await runJob(job);
      if (r?.message && r.message.id != null) {
        const p = runTurn(r.message).catch((e) => fatal(e)).finally(() => running.delete(p));
        running.add(p);
      }
      if (once) { await Promise.all(running); if (failure) throw failure; return; }
    }
  }

  return { run, runTurn, runJob, ledger, gm, scenarios, log };
}

async function main() {
  const cfg = bridgeConfig();
  const die = (e) => {
    const text = `fake-bridge: ${e && e.message ? e.message : e}`;
    process.stderr.write(`${text}\n`);
    try { fs.mkdirSync(cfg.e2eDir, { recursive: true }); fs.appendFileSync(cfg.logFile, `${new Date().toISOString()} FATAL ${text}\n`); } catch { process.stderr.write('fake-bridge: bridge.log not writable\n'); }
    process.exit(e instanceof DockError ? 2 : 1);
  };
  process.on('unhandledRejection', die);
  try {
    await createBridge(cfg).run({ once: process.argv.includes('--once') });
  } catch (e) { die(e); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
