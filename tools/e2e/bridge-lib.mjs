import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const fwd = (p) => String(p).replace(/\\/g, '/');
const nowIso = () => new Date().toISOString();
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readBytes = (file) => { try { return fs.readFileSync(file); } catch { return null; } };
const atomic = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export const TICKET_KEY = /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;
const KEY_IN_TEXT = /\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/;
const PULL_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

export function uuidFrom(text) {
  const h = crypto.createHash('sha1').update(String(text)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function loadScenarios(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return files.map((file) => {
    const scenario = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!scenario.name || !Array.isArray(scenario.turns) || !scenario.turns.length) throw new Error(`scenario ${file} needs a name and at least one turn`);
    return { ...scenario, file, priority: Number(scenario.match?.priority) || 0 };
  });
}

export function partyOf(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^## Party\s*$/.test(l));
  if (start < 0) return null;
  const block = [];
  for (let i = start + 1; i < lines.length && /^(mode|worker|verify|skip|by):/.test(lines[i].trim()); i++) block.push(lines[i].trim());
  const mode = block.map((l) => /^mode: (light|full)$/.exec(l)).find(Boolean);
  return { lines: block, mode: mode ? mode[1] : null };
}

export function contextOf(msg, { boardRoot }) {
  const text = String(msg.text || '');
  const keyMatch = KEY_IN_TEXT.exec(text);
  const key = keyMatch ? keyMatch[1] : null;
  const judge = /^Pakai skill judge:/m.test(text) || /^Judge-/.test(String(msg.title || ''));
  const judgeMatch = /Pakai skill judge: session (\S+) input (\S+) until (\S+)/.exec(text);
  const round = /\(round (\S+?)\)/.exec(text);
  const board = /BOARD=(\S+?)(?:,|\s|$)/.exec(text);
  const plan = /Pakai skill sous: plan (.+?)\.(?:\s|$)/.exec(text);
  const owners = /Owner tickets to order: (.+?)\. /.exec(text);
  const light = /^Light settings: (.+)$/m.exec(text);
  const contract = key ? readBytes(path.join(boardRoot, key, 'materials', 'contract.md')) : null;
  const party = contract ? partyOf(contract.toString('utf8')) : null;
  const mode = /\b(light|full)\b/i.exec(text);
  const pull = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(text);
  return {
    text,
    mode: msg.mode === 'gm' ? 'gm' : 'work',
    gmConfirm: Boolean(msg.gmConfirm),
    judge,
    vars: {
      key: key || '',
      keyNum: key ? key.split('-')[1] : '',
      sessionId: String(msg.sessionId || ''),
      messageId: String(msg.id ?? ''),
      prUrls: [...new Set(text.match(PULL_URL) || [])].join(' '),
      prUrl: (text.match(PULL_URL) || [''])[0],
      prRepo: pull ? pull[1] : '',
      prNumber: pull ? pull[2] : '',
      roundId: round ? round[1] : '',
      board: board ? board[1] : key ? fwd(path.join(boardRoot, key)) : '',
      judgeSession: judgeMatch ? judgeMatch[1] : '',
      judgeUntil: judgeMatch ? judgeMatch[3] : '',
      sprint: plan ? plan[1] : '',
      ownerKeys: owners ? owners[1] : '',
      lightSettings: light ? light[1] : '',
      partyMode: party?.mode || 'none',
      askedMode: mode ? mode[1].toLowerCase() : 'light',
    },
  };
}

const matchParty = (want, have) => (want.startsWith('!') ? have !== want.slice(1) : have === want);

export function matches(scenario, ctx) {
  const m = scenario.match || {};
  if (m.mode && m.mode !== ctx.mode) return false;
  if (m.gmConfirm !== undefined && m.gmConfirm !== ctx.gmConfirm) return false;
  if (m.judge !== undefined && m.judge !== ctx.judge) return false;
  if (m.text && !new RegExp(m.text, 'm').test(ctx.text)) return false;
  if (m.notText && new RegExp(m.notText, 'm').test(ctx.text)) return false;
  if (m.party && !matchParty(m.party, ctx.vars.partyMode)) return false;
  if (m.needsKey && !ctx.vars.key) return false;
  return true;
}

export function selectScenario(scenarios, ctx) {
  let best = null;
  for (const s of scenarios) if (matches(s, ctx) && (!best || s.priority > best.priority)) best = s;
  return best;
}

export function fill(value, vars) {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] === undefined ? '' : String(vars[name])));
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [fill(k, vars), fill(v, vars)]));
  return value;
}

const LEGACY_STATUS = { SHOV: 'GUESS' };
const line = (t) => String(t ?? '').replace(/\r?\n/g, ' ');
const cell = (t) => line(t).replace(/\|/g, '\\|');
const stamp = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '-');
const IN_FORCE = ['DECIDED', 'GUESS', 'USULAN'];
const STAGES = ['gate', 'plan', 'code', 'test', 'verify', 'evidence', 'commit', 'pr', 'done', 'blocked'];

const decisionsOf = (s) => (s.decisions ?? []).map((d, i) => ({ ...d, n: d.n ?? i + 1, status: LEGACY_STATUS[d.status] ?? d.status ?? 'DECIDED', by: d.by ?? 'owner' }));

function closing(s, end) {
  const history = s.history ?? [];
  const start = s.createdAt ?? history[0]?.at ?? null;
  const failures = {};
  for (const x of s.failures ?? []) failures[x.type] = (failures[x.type] ?? 0) + 1;
  return {
    at: end,
    hours: start ? Math.round((new Date(end) - new Date(start)) / 360000) / 10 : null,
    fixRounds: history.filter((h) => h.to === 'code' && ['test', 'verify', 'evidence', 'commit', 'pr'].includes(h.from)).length,
    failures,
    replans: (s.replans ?? []).length,
  };
}

function moveStage(s, to) {
  if (!STAGES.includes(to)) throw new Error(`stage must be one of ${STAGES.join(', ')}`);
  const from = s.stage;
  if (from === to) return;
  s.stage = to;
  (s.history ??= []).push({ at: nowIso(), from: from ?? null, to });
  if (to === 'done') s.closing = closing(s, nowIso());
}

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}

export function renderStatus(key, s) {
  const head = `<!-- generated, do not edit: \`status.cjs render ${key}\` rebuilds this file from the ledger -->\n`;
  const decisions = decisionsOf(s);
  const open = (s.issues ?? []).filter((x) => x.status === 'open');
  const findingsOpen = (s.findings ?? []).map((f, i) => ({ ...f, n: i + 1 })).filter((f) => !f.resolved);
  const inForce = decisions.filter((d) => IN_FORCE.includes(d.status));
  const short = (t) => { const v = line(t); return v.length > 160 ? `${v.slice(0, 159)}…` : v; };
  const events = [
    ...(s.history ?? []).map((h) => [h.at, 'STAGE', `${h.from ?? '-'} -> ${h.to}`]),
    ...decisions.map((d) => [d.at, 'DECISION', `D-${d.n} ${d.status} by ${d.by}: ${d.text}`]),
    ...(s.handoffs ?? []).map((h) => [h.at, 'HANDOFF', `${h.who} ${h.status}: ${h.summary}${h.proven ? '' : ' (unproven)'}`]),
    ...(s.failures ?? []).map((f) => [f.at, 'FAIL', `${f.type} #${f.attempt}${f.what ? ` ${f.what}` : ''}`]),
    ...(s.findings ?? []).map((f) => [f.at, 'FINDING', `${f.severity}: ${f.text}`]),
    ...(s.findings ?? []).flatMap((f, i) => (f.resolved ? [[f.resolved.at, 'FINDING-RESOLVED', `#${i + 1}: ${f.resolved.why}`]] : [])),
  ].filter((e) => e[0]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const days = [];
  for (const [at, m, t] of events) {
    const day = String(at).slice(0, 10);
    if (days.at(-1)?.day !== day) days.push({ day, rows: [] });
    days.at(-1).rows.push(`- ${String(at).slice(11, 16)} · ${m} · ${short(t)}`);
  }
  const weekday = (day) => (Number.isNaN(Date.parse(day)) ? '' : ` ${new Date(`${day}T00:00:00Z`).toUTCString().slice(0, 3)}`);
  return [
    `${head}# Status - ${key}${s.title ? ` · ${line(s.title)}` : ''}`, '',
    `Stage: ${s.stage ?? '-'} · PR ${[s.pr?.be, s.pr?.fe].filter(Boolean).join(' ') || '-'} · updated ${stamp(s.updatedAt)}`, '',
    '## Now', '',
    `- Stage: ${s.stage ?? '-'}`,
    `- Waiting on: ${short(s.waiting || '-')}`,
    `- Open issues: ${open.length} · open findings: ${findingsOpen.length} · decisions in force: ${inForce.length} (0 superseded)`,
    ...findingsOpen.map((f) => `  - finding #${f.n} ${f.severity}: ${short(f.text)}`),
    ...inForce.map((d) => `  - D-${d.n} ${d.status} by ${d.by}: ${short(d.text)}`), '',
    'Log lines: `HH:MM · MARKER · what`, one section per UTC day; long text is cut, the full text is in `decisions.md`, `issues.md` and the ledger.', '',
    ...days.flatMap(({ day, rows }) => [`## ${day}${weekday(day)}`, '', ...rows, '']),
  ].join('\n');
}

function renderNow(key, s) {
  const head = `<!-- generated, do not edit: \`status.cjs render ${key}\` rebuilds this file from the ledger -->\n`;
  const rows = [
    ['Stage', s.stage], ['Kind', s.kind ?? 'ticket'], ['Engine', s.engine ?? '-'], ['Waiting on the owner', s.waiting || '-'],
    ['Draft PR', s.draft ? 'yes' : 'no'], ['PR', [s.pr?.be, s.pr?.fe].filter(Boolean).join(' ') || '-'],
  ];
  return [
    `${head}# NOW - ${key} ${s.title ?? ''} · per ${stamp(s.updatedAt)}`, '',
    '| Field | Value |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`), '',
    '## Acceptance criteria', '', '| AC | State | Text |', '|---|---|---|', ...(s.ac ?? []).map((a) => `| ${a.n} | ${a.state} | ${cell(a.text)} |`), '',
  ].join('\n');
}

function renderDecisions(key, s) {
  const head = `<!-- generated, do not edit: \`status.cjs render ${key}\` rebuilds this file from the ledger -->\n`;
  const blocks = decisionsOf(s).map((d) => [`## D-${d.n}`, `- **Status:** ${d.status} · **By:** ${d.by} · **At:** ${stamp(d.at)}`, `- **Decision:** ${line(d.text)}`].join('\n'));
  return `${head}# Decisions - ${key}\n\nPrecedence: owner DECIDED > GUESS > contract > Jira AC > USULAN. CANCELLED and SUPERSEDED entries do not apply.\n\n${blocks.join('\n\n')}\n`;
}

export function createLedger({ evidenceRoot, boardRoot }) {
  const file = (key) => path.join(evidenceRoot, key, 'status.json');
  const load = (key) => readJson(file(key));
  const boardDir = (key) => path.join(boardRoot, key);
  function save(key, s) {
    s.updatedAt = nowIso();
    if (s.engine === 'sous') s.blackboard = fwd(boardDir(key));
    atomic(file(key), JSON.stringify(s, null, 2));
    if (s.engine === 'sous') {
      atomic(path.join(boardDir(key), 'status.md'), renderStatus(key, s));
      atomic(path.join(boardDir(key), 'NOW.md'), renderNow(key, s));
      atomic(path.join(boardDir(key), 'decisions.md'), renderDecisions(key, s));
      atomic(path.join(boardDir(key), 'issues.md'), `<!-- generated, do not edit: \`status.cjs render ${key}\` rebuilds this file from the ledger -->\n# Issues - ${key}\n\n## Open\n\nnone\n\n## Resolved\n\nnone\n`);
    }
    return s;
  }
  function apply(key, op) {
    if (!TICKET_KEY.test(String(key))) throw new Error(`ledger op ${op.op} needs a ticket key, got "${key}"`);
    const at = nowIso();
    if (op.op === 'init') {
      const s = load(key) ?? { key, ac: [], createdAt: at };
      Object.assign(s, { title: op.title ?? s.title ?? key, stage: s.stage ?? 'gate', waiting: s.waiting ?? '', ports: s.ports ?? { be: null, fe: null }, dirs: s.dirs ?? { be: null, fe: null } });
      if (op.kind) s.kind = op.kind;
      return save(key, s);
    }
    const s = load(key);
    if (!s) throw new Error(`no status for ${key}; the scenario must init it first`);
    switch (op.op) {
      case 'set':
        for (const [k, v] of Object.entries(op.values || {})) {
          if (k === 'stage') moveStage(s, v);
          else if (v === '' && ['mode', 'engine'].includes(k)) delete s[k];
          else setPath(s, k, v);
        }
        break;
      case 'dispatch':
        (s.dispatches ??= []).push({ at, agent: op.agent, model: op.model, ...(op.step ? { step: op.step } : {}), ...(s.mode ? { mode: s.mode } : {}) });
        break;
      case 'acSet':
        s.ac = (op.lines || []).map((text, i) => ({ n: i + 1, state: 'TODO', text, evidence: '' }));
        atomic(path.join(boardDir(key), 'ac.txt'), `${(op.lines || []).join('\n')}\n`);
        break;
      case 'ac':
        s.ac[Number(op.n) - 1] = { n: Number(op.n), state: op.state, text: op.text ?? s.ac[Number(op.n) - 1]?.text ?? '', evidence: op.evidence ?? '' };
        break;
      case 'handoff':
        (s.handoffs ??= []).push({ at, who: op.who, status: op.status, summary: op.summary, evidence: op.evidence ?? '', unverified: op.unverified ?? 'none', proven: true });
        break;
      case 'finding':
        (s.findings ??= []).push({ at, severity: op.severity || 'non-blocking', text: op.text });
        break;
      case 'findingResolve': {
        const f = (s.findings ?? [])[Number(op.n) - 1];
        if (!f) throw new Error(`${key} has no finding #${op.n}`);
        f.resolved = { at, why: op.why };
        break;
      }
      case 'lgtm':
        (s.lgtm ??= []).push({ at, text: op.text });
        break;
      case 'verdict':
        if (op.value === 'approve' && (s.findings ?? []).some((f) => f.severity === 'blocker' && !f.resolved)) throw new Error(`${key} has an unresolved blocker; approve is refused`);
        s.verdict = { at, value: op.value, ticket: op.ticket || key, prs: op.prs ?? [s.pr?.be, s.pr?.fe].filter(Boolean), ...(op.readyForQa ? { readyForQa: op.readyForQa } : {}) };
        break;
      case 'decide':
        (s.decisions ??= []).push({ n: (s.decisions?.length ?? 0) + 1, at, text: op.text, status: op.status || 'DECIDED', by: op.by || 'owner' });
        break;
      case 'fail': {
        const attempt = (s.failures ?? []).filter((x) => x.type === op.type && x.what === (op.what || '')).length + 1;
        (s.failures ??= []).push({ at, type: op.type, what: op.what || '', evidence: op.evidence, attempt });
        break;
      }
      case 'brief':
        s.brief = op.text;
        break;
      default:
        throw new Error(`unknown ledger op ${op.op}`);
    }
    return save(key, s);
  }
  return { load, apply, file, boardDir };
}

export function appendScout(contractFile, scoutLine) {
  const cur = readBytes(contractFile);
  const text = cur ? cur.toString('utf8') : '';
  const body = text === '' || /\r?\n$/.test(text) ? text : `${text}\n`;
  atomic(contractFile, `${body}${scoutLine}\n`);
}

export const scoutLine = ({ repos, files, contract, verdict }) => `Scout: ${repos} · ~${files} files · ${contract} → ${verdict}`;

const partyAt = (text) => {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^## Party\s*$/.test(l));
  if (start < 0) return { lines, start: -1, end: -1, party: null };
  let end = start + 1;
  while (end < lines.length && /^(mode|worker|verify|skip|by):/.test(lines[end].trim())) end++;
  return { lines, start, end, party: lines.slice(start + 1, end).map((l) => l.trim()) };
};

export const withParty = (text, party) => {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const at = partyAt(text);
  const block = party ? ['## Party', ...party] : [];
  if (at.start >= 0) return [...at.lines.slice(0, at.start), ...block, ...at.lines.slice(at.end)].join(eol);
  if (!party) return text;
  const body = text === '' ? '' : /\r?\n$/.test(text) ? text : `${text}${eol}`;
  return `${body}${body ? eol : ''}${block.join(eol)}${eol}`;
};

const partyLines = (mode, worker) => (mode === 'light' ? ['mode: light', `worker: sous-ticket-worker (${worker || 'sonnet'})`] : ['mode: full']);
const plainLine = (t) => String(t).replace(/[^A-Za-z0-9 ·~,.:+()#>→/-]/g, '').trim().slice(0, 160);

export function createGm({ stateDir, boardRoot }) {
  const root = path.join(stateDir, 'gm');
  const logFile = path.join(root, 'log.jsonl');
  const backups = path.join(root, 'backups');
  const pendingFile = (sessionId) => path.join(root, 'pending', `${String(sessionId).replace(/[^A-Za-z0-9-]/g, '')}.json`);
  const contractFile = (key) => {
    if (!TICKET_KEY.test(String(key))) throw new Error('A ticket key looks like QRD-1542');
    return path.join(boardRoot, key, 'materials', 'contract.md');
  };
  const mac = (key, row) => crypto.createHmac('sha256', String(key)).update(JSON.stringify({ ...row, mac: undefined })).digest('hex');
  const macOk = (row, key) => Boolean(key) && typeof row.mac === 'string' && row.mac.length === 64 && crypto.timingSafeEqual(Buffer.from(row.mac), Buffer.from(mac(key, row)));
  function entries() {
    let text = '';
    try { text = fs.readFileSync(logFile, 'utf8'); } catch { return []; }
    return text.split('\n').flatMap((l) => { try { const e = JSON.parse(l); return e && Number.isInteger(e.id) ? [e] : []; } catch { return []; } });
  }
  function append(entry, key, write) {
    const id = entries().reduce((m, e) => Math.max(m, e.id), 0) + 1;
    const extra = write ? write(id) : null;
    const row = { id, at: nowIso(), ...entry, ...(extra || {}) };
    row.mac = mac(key, row);
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify(row)}\n`);
    return row;
  }
  function backup(bytes, label) {
    const name = `${nowIso().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}-${label}-${crypto.randomBytes(3).toString('hex')}.bak`;
    fs.mkdirSync(backups, { recursive: true });
    fs.writeFileSync(path.join(backups, name), bytes);
    return { backup: name, backupSha: sha256(bytes) };
  }
  function view(key) {
    const rows = entries();
    const rolled = new Set(rows.filter((e) => Number.isInteger(e.rollbackOf)).map((e) => e.rollbackOf));
    return rows.reverse().map((row) => {
      const { mac: _mac, ...e } = row;
      return { ...e, rolledBack: rolled.has(e.id), restoreValues: null, unverified: key ? !macOk(row, key) : !(typeof row.mac === 'string' && row.mac.length === 64) };
    });
  }
  const pendingRaw = (sessionId) => { const b = readBytes(pendingFile(sessionId)); return b ? b.toString('utf8') : null; };
  const discard = (sessionId) => { try { fs.rmSync(pendingFile(sessionId), { force: true }); } catch { /* already gone */ } };
  const partyDiff = (key, text, party) => {
    const old = text !== null ? partyAt(text).party || [] : [];
    const scout = text ? text.split(/\r?\n/).reverse().find((l) => /^Scout: /.test(l)) : null;
    return [`contract > Party (${key})`, `  ${scout ? plainLine(scout) : 'no Scout line yet'}`, ...old.map((l) => `- ${plainLine(l)}`), ...party.map((l) => `+ ${l}`), '+ by: Guild Master, log #<on write>'].join('\n');
  };
  function proposeParty(sessionId, key, { mode, worker } = {}) {
    if (!['light', 'full'].includes(mode)) throw new Error('--mode must be light or full');
    const party = partyLines(mode, worker);
    const cur = readBytes(contractFile(key));
    const text = cur ? cur.toString('utf8') : null;
    const change = { type: 'party', key, target: `blackboard ${key} materials/contract.md`, mode, worker: mode === 'light' ? worker || 'sonnet' : null, party, beforeSha: sha256(cur ?? Buffer.alloc(0)), diff: partyDiff(key, text, party), summary: `Party ${key}: ${mode}` };
    atomic(pendingFile(sessionId), JSON.stringify({ ...change, at: nowIso() }));
    return change;
  }
  async function apply({ sessionId, gmConfirm, key, confirm }) {
    const c = gmConfirm && typeof gmConfirm === 'object' ? gmConfirm : null;
    if (!c || typeof c.nonce !== 'string' || !c.nonce || typeof c.sha256 !== 'string') return { ok: false, error: 'No confirmation from DOCK, so nothing was written' };
    if (!(Number(c.exp) > Date.now())) return { ok: false, error: 'The confirmation expired, so nothing was written' };
    if (!key) return { ok: false, error: 'DOCK sent no log key, so nothing was written' };
    const raw = pendingRaw(sessionId);
    discard(sessionId);
    if (!raw) return { ok: false, error: 'No change was waiting for a yes' };
    if (sha256(raw) !== c.sha256) return { ok: false, error: 'The change waiting is not the one DOCK showed the owner, so nothing was written' };
    const change = JSON.parse(raw);
    if (change.type !== 'party') return { ok: false, error: `The e2e bridge applies Party changes only, not ${change.type}` };
    const file = contractFile(change.key);
    const before = readBytes(file);
    if (sha256(before ?? Buffer.alloc(0)) !== change.beforeSha) return { ok: false, error: 'The Party changed since the proposal; ask again' };
    const saved = backup(before ?? Buffer.alloc(0), `contract-${change.key}`);
    await confirm({ sessionId, nonce: c.nonce, sha256: c.sha256 });
    const party = partyLines(change.mode, change.worker || undefined);
    const entry = append({ by: 'owner', sessionId, kind: 'change', type: 'party', ticket: change.key, target: change.target, summary: change.summary, diff: change.diff, ...saved }, key, (id) => {
      const lines = [...party, `by: Guild Master, log #${id}`];
      const cur = readBytes(file);
      atomic(file, withParty(cur ? cur.toString('utf8') : '', lines));
      return { party: lines };
    });
    return { ok: true, entry };
  }
  async function rollback({ id, key, nonce, confirm }) {
    const raw = entries().find((e) => e.id === Number(id));
    if (!raw) return { ok: false, error: `No manager log entry #${id}` };
    if (view().find((e) => e.id === raw.id)?.rolledBack) return { ok: false, error: `#${raw.id} is already rolled back` };
    if (!macOk(raw, key)) return { ok: false, error: `#${raw.id} was not written by Guild Master and cannot be rolled back` };
    if (raw.type !== 'party') return { ok: false, error: `The e2e bridge rolls back Party entries only, not ${raw.type}` };
    const bytes = fs.readFileSync(path.join(backups, raw.backup));
    if (sha256(bytes) !== raw.backupSha) return { ok: false, error: `The backup of #${raw.id} changed since it was written` };
    const file = contractFile(raw.ticket);
    const cur = readBytes(file);
    const saved = backup(cur ?? Buffer.alloc(0), `contract-${raw.ticket}`);
    await confirm({ sessionId: null, nonce, sha256: `rollback:${raw.id}` });
    atomic(file, withParty(cur ? cur.toString('utf8') : '', partyAt(bytes.toString('utf8')).party));
    const entry = append({ by: 'owner (manager log)', sessionId: null, kind: 'rollback', type: 'party', ticket: raw.ticket, target: raw.target, summary: `Rollback of #${raw.id} (${raw.summary})`, ...saved, rollbackOf: raw.id }, key);
    return { ok: true, entry };
  }
  return { entries, view, proposeParty, pendingRaw, discard, apply, rollback, contractFile, root };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

export function png(width = 320, height = 180, [r, g, b] = [30, 64, 120]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const shade = (x + y) % 32 < 16 ? 0 : 24;
      raw[row + 1 + x * 3] = Math.min(255, r + shade);
      raw[row + 2 + x * 3] = Math.min(255, g + shade);
      raw[row + 3 + x * 3] = Math.min(255, b + shade);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const MODEL_IDS = { opus: 'claude-opus-4-1-20250805', sonnet: 'claude-sonnet-4-5-20250929', haiku: 'claude-haiku-4-5-20251001' };

const usageLine = (sessionId, model, tokens, at, extra = {}) => {
  const input = Math.round(tokens * 0.2);
  const cache = Math.round(tokens * 0.7);
  return JSON.stringify({
    type: 'assistant', sessionId, timestamp: at, requestId: `req_${crypto.randomBytes(8).toString('hex')}`, ...extra,
    message: { id: `msg_${crypto.randomBytes(8).toString('hex')}`, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'e2e' }], usage: { input_tokens: input, cache_read_input_tokens: cache, cache_creation_input_tokens: 0, output_tokens: tokens - input - cache } },
  });
};

export function writeTranscripts({ configDir, project, claudeSessionId, mainModel = 'sonnet', mainTokens = 0, agents = [], cwd = '' }) {
  const dir = path.join(configDir, 'projects', project);
  fs.mkdirSync(dir, { recursive: true });
  const at = nowIso();
  if (mainTokens > 0) fs.appendFileSync(path.join(dir, `${claudeSessionId}.jsonl`), `${usageLine(claudeSessionId, MODEL_IDS[mainModel] || mainModel, mainTokens, at, { cwd })}\n`);
  const sub = path.join(dir, claudeSessionId, 'subagents');
  for (const agent of agents) {
    fs.mkdirSync(sub, { recursive: true });
    const model = MODEL_IDS[agent.model] || agent.model;
    const half = Math.max(1, Math.round(agent.tokens / 2));
    const lines = [usageLine(claudeSessionId, model, half, at, { agentId: agent.id, isSidechain: true }), usageLine(claudeSessionId, model, agent.tokens - half, at, { agentId: agent.id, isSidechain: true })];
    fs.writeFileSync(path.join(sub, `agent-${agent.id}.jsonl`), `${lines.join('\n')}\n`);
    fs.writeFileSync(path.join(sub, `agent-${agent.id}.meta.json`), JSON.stringify({ agentType: agent.type, description: agent.detail || agent.type, toolUseId: `toolu_${agent.id}` }));
  }
  return dir;
}
