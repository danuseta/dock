export interface SprintEvent {
  at: string;
  by: string | null;
  field: string;
  from: string | null;
  to: string | null;
}

export interface SprintIssue {
  key: string;
  summary: string;
  created: string;
  type: string;
  status: string;
  assignee: string | null;
  sp: number | null;
  labels: string[];
  events: SprintEvent[];
}

export interface RosterMember {
  full: string;
  short: string;
  token: string;
  color?: string;
}

export interface SprintConfig {
  roster: RosterMember[];
  loadTarget: number;
  targetPerDev: number;
  bugMarginPerDev: number;
  slaDays: number;
  tzOffsetHours: number;
  weekendWeight: number;
  cutoffs: Record<string, string>;
  dailyHour: number;
  statusAliases: Record<string, string>;
}

export interface SprintWindow {
  id: number;
  name: string;
  state: 'active' | 'closed';
  start: string;
  end: string;
}

export const DEFAULT_SPRINT_CONFIG: SprintConfig = {
  roster: [],
  loadTarget: 16,
  targetPerDev: 15,
  bugMarginPerDev: 5,
  slaDays: 2,
  tzOffsetHours: 8,
  weekendWeight: 0.12,
  cutoffs: {},
  dailyHour: 6,
  statusAliases: { 'Blocked': 'To Do', 'In Review': 'To Do', 'Move to IT': 'To Do', 'Revision': 'To Do' },
};

export const RULES_VERSION = 4;

export type Tone = 'g' | 'a' | 'r';
export type Bucket = 'Todo' | 'InP' | 'PR' | 'UATM' | 'UATC' | 'UATB' | 'RFP' | 'Done';
export type Buckets = Record<Bucket, number>;
export type StageName = 'In Progress' | 'PR Review' | 'UAT Merged' | 'UAT Check' | 'RFP';

export interface IssueRef { key: string; summary: string }
export interface Toned<T> { value: T; tone: Tone }

export interface StartRow { dev: string; buckets: Buckets; total: number; load: number; loadTone: Tone }
export interface EndRow {
  dev: string; buckets: Buckets; total: number; eligSP: number; compSP: number;
  completion: number | null; completionTone: Tone | null; carryover: number;
  inDev: number; review: number; velocity: number | null; velocityTone: Tone | null;
  carrySP: number; bugSP: number;
}
export interface GateRow {
  dev: string; passed: number; reworked: number; pending: number; scopeSP: number;
  rate: number | null; rateTone: Tone | null; challenging: IssueRef[];
}
export interface ReviewerRow {
  dev: string; issues: number; sp: number; failedSP: number;
  failRate: number | null; failTone: Tone | null; bounced: IssueRef[];
  avg: number | null; avgTone: Tone | null; max: number | null; breaches: number; noDuration: number;
}
export interface StageRow { dev: string; stages: Record<StageName, Toned<number> | null> }
export interface Flag { sev: 'R' | 'A' | 'B'; dev: string; metric: string; desc: string }
export interface ExcludedIssue {
  key: string; summary: string; assignee: string | null; status: string; sp: number | null;
  reason: 'removed-from-sprint' | 'not-in-roster' | 'unknown-status';
}

export interface SprintResult {
  rulesVersion: number;
  sprint: { id: number; name: string; label: string; num: number; state: string; start: string; end: string };
  cutoff: string;
  roster: RosterMember[];
  overview: {
    developers: number; totalSP: number; allocated: number; carryover: number; bugSP: number; doneSP: number;
    targetSP: number; bugMargin: number; loadTarget: number;
    pipeline: { inDev: number; uatMerged: number; uatCheckRfp: number; uatBug: number; done: number };
  };
  start: StartRow[];
  end: EndRow[];
  pr: GateRow[];
  qa: GateRow[];
  reviewers: ReviewerRow[];
  unattributedSP: number;
  teamAvgSPReviewed: number | null;
  stages: StageRow[];
  flags: Flag[];
  notes: {
    addedAfterStart: number;
    noSprintEvents: number;
    noSprintLabel: number;
    nonSelfPass: Array<{ key: string; token: string; by: string | null }>;
    prePassIgnored: number;
    passWithoutDuration: number;
    revertedToUatMerged: number;
    earlyPushBacks: string[];
    aliasHits: Array<{ status: string; count: number; keys: string[] }>;
    excluded: ExcludedIssue[];
  };
}

export interface SprintTrend {
  labels: string[];
  series: Array<{ dev: string; color: string | null; data: Array<number | null> }>;
}

const BUCKET: Record<string, Bucket> = {
  'To Do': 'Todo', 'In Progress': 'InP', 'PR Review': 'PR', 'UAT MERGED': 'UATM', 'UAT CHECK': 'UATC',
  'UAT BUG / Improvement': 'UATB', 'ReadyForProduction': 'RFP', 'Done / MERGED': 'Done',
};
const BUCKETS: Bucket[] = ['Todo', 'InP', 'PR', 'UATM', 'UATC', 'UATB', 'RFP', 'Done'];
const RANK: Record<string, number> = {
  'To Do': 0, 'In Progress': 1, 'PR Review': 2, 'UAT MERGED': 3, 'UAT CHECK': 4,
  'UAT BUG / Improvement': 5, 'ReadyForProduction': 6, 'Done / MERGED': 7,
};
const STAGES: Array<[StageName, string]> = [
  ['In Progress', 'In Progress'], ['PR Review', 'PR Review'], ['UAT Merged', 'UAT MERGED'],
  ['UAT Check', 'UAT CHECK'], ['RFP', 'ReadyForProduction'],
];

const parseTime = (value: string) => Date.parse(value.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
const round2 = (n: number) => Math.round(n * 100) / 100;
export const roundHalfEven = (value: number): number => {
  const floor = Math.floor(value);
  if (Math.abs(value - floor - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
};
const num = (value: unknown): number | null => (value === null || value === undefined || value === '') ? null : Number(value);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) => values.length ? sum(values) / values.length : null;
const emptyBuckets = (): Buckets => ({ Todo: 0, InP: 0, PR: 0, UATM: 0, UATC: 0, UATB: 0, RFP: 0, Done: 0 });

const toneLoad = (ratio: number, loadTarget: number): Tone => ratio <= 4 / 3 ? 'g' : ratio * loadTarget <= 26 ? 'a' : 'r';
const toneCompletion = (p: number): Tone => p >= 0.6 ? 'g' : p >= 0.4 ? 'a' : 'r';
const toneVelocity = (p: number): Tone => p >= 0.8 ? 'g' : p >= 0.5 ? 'a' : 'r';
const tonePR = (p: number): Tone => p >= 0.85 ? 'g' : p >= 0.7 ? 'a' : 'r';
const toneQA = (p: number): Tone => p >= 0.8 ? 'g' : p >= 0.7 ? 'a' : 'r';
const toneFail = (p: number): Tone => p < 0.2 ? 'g' : p < 0.45 ? 'a' : 'r';
const toneReviewDays = (v: number): Tone => v <= 2 ? 'g' : v <= 3 ? 'a' : 'r';
const toneStage = (v: number, rfp: boolean): Tone => rfp
  ? (v <= 3 ? 'g' : v <= 7 ? 'a' : 'r')
  : (v <= 1.2 ? 'g' : v <= 2 ? 'a' : 'r');

interface Entry {
  issue: SprintIssue & { ev: Array<SprintEvent & { t: number }>; createdT: number };
  summary: string;
  joinedAfterStart: boolean;
  startStatus: string;
  startBucket: Bucket;
  endStatus: string;
  endBucket: Bucket;
  sp: number;
  cls: 'alloc' | 'carry' | 'bug';
  dev: RosterMember;
  tr: Array<{ t: number; from: string; to: string }>;
  gate: Record<string, 'passed' | 'reworked' | 'pending'>;
}

export function sprintLabel(name: string): { label: string; num: number } {
  const match = name.match(/(\d+)\s*$/);
  const number = match ? Number(match[1]) : 0;
  return { label: `${name.split(/\s+/)[0]}${number}`, num: number };
}

const PASS_LABEL = /^[A-Za-z][A-Za-z0-9]*Pass$/;

function shortName(full: string, token: string): string {
  const stem = token.slice(0, -'Pass'.length).toLowerCase();
  const words = full.split(/\s+/).filter(Boolean);
  const byStem = words.find((word) => word.length > 1 && word.toLowerCase().includes(stem));
  return byStem || words.find((word) => word.length > 1) || full;
}

export function detectRoster(issues: SprintIssue[], overrides: RosterMember[] = []): RosterMember[] {
  const added = new Map<string, Map<string, number>>();
  for (const issue of issues) {
    for (const event of issue.events) {
      if (event.field !== 'labels' || !event.by) continue;
      const before = new Set((event.from || '').split(/\s+/));
      for (const label of (event.to || '').split(/\s+/)) {
        if (!PASS_LABEL.test(label) || before.has(label)) continue;
        const authors = added.get(label) || new Map<string, number>();
        authors.set(event.by, (authors.get(event.by) || 0) + 1);
        added.set(label, authors);
      }
    }
  }
  const owned = new Map<string, { token: string; count: number }>();
  for (const [token, authors] of added) {
    const [owner, count] = [...authors].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (count > (owned.get(owner)?.count || 0)) owned.set(owner, { token, count });
  }
  const roster = new Map<string, RosterMember>();
  for (const [full, { token }] of owned) roster.set(full, { full, short: shortName(full, token), token });
  for (const member of overrides) roster.set(member.full, { ...roster.get(member.full), ...member });
  return [...roster.values()];
}

export function computeSprintMetrics(window: SprintWindow, rawIssues: SprintIssue[], config: SprintConfig): SprintResult {
  const { loadTarget, targetPerDev, bugMarginPerDev, slaDays } = config;
  const roster = detectRoster(rawIssues, config.roster);
  const tzMs = config.tzOffsetHours * 3600 * 1000;
  const { label, num: sprintNum } = sprintLabel(window.name);
  const dayStart = (t: number) => Math.floor((t + tzMs) / 86400000) * 86400000 - tzMs;
  const T0 = dayStart(parseTime(window.start));
  const endT = parseTime(config.cutoffs[label] || window.end);

  const norm = (status: string | null): string => (status === null ? '' : config.statusAliases[status] || status);
  const devByFull = new Map(roster.map((d) => [d.full, d]));
  const devByToken = new Map(roster.map((d) => [d.token, d]));
  const rosterKeys = [...roster].sort((a, b) => a.full.localeCompare(b.full)).map((d) => d.short);

  function wdays(t1: number, t2: number): number {
    if (t2 <= t1) return 0;
    let total = 0;
    let d = Math.floor((t1 + tzMs) / 86400000);
    const dEnd = Math.floor((t2 + tzMs) / 86400000);
    for (; d <= dEnd; d++) {
      const dow = new Date(d * 86400000).getUTCDay();
      const weight = dow === 0 || dow === 6 ? config.weekendWeight : 1;
      const a = Math.max(t1, d * 86400000 - tzMs);
      const b = Math.min(t2, (d + 1) * 86400000 - tzMs);
      if (b > a) total += weight * (b - a) / 86400000;
    }
    return total;
  }

  let latest = 0;
  const issues = rawIssues.map((raw) => {
    const ev = raw.events.map((e) => ({ ...e, t: parseTime(e.at) })).sort((a, b) => a.t - b.t);
    ev.forEach((e) => { if (e.t > latest) latest = e.t; });
    return { ...raw, ev, createdT: parseTime(raw.created) };
  });
  type Issue = typeof issues[number];
  const CUTOFF = window.state === 'closed' ? Math.min(latest || endT, endT) : latest || T0;

  const evs = (i: Issue, field: string) => i.ev.filter((e) => e.field === field);
  const valAt = (i: Issue, field: string, t: number, current: string | null): string | null => {
    const es = evs(i, field);
    if (!es.length) return current;
    let v = es[0].from;
    for (const e of es) { if (e.t <= t) v = e.to; else break; }
    return v;
  };
  const sprintList = (s: string | null) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const sprintsAt = (i: Issue, t: number): string[] => {
    const es = evs(i, 'Sprint');
    if (!es.length) return i.createdT <= t ? [window.name] : [];
    let v = es[0].from;
    for (const e of es) { if (e.t <= t) v = e.to; else break; }
    return sprintList(v);
  };
  const joinTime = (i: Issue): number => {
    const es = evs(i, 'Sprint');
    if (!es.length) return i.createdT;
    if (sprintList(es[0].from).includes(window.name)) return i.createdT;
    const e = es.find((x) => sprintList(x.to).includes(window.name));
    return e ? e.t : i.createdT;
  };
  const firstSP = (i: Issue): number | null => {
    const es = evs(i, 'Story point estimate');
    const candidates = es.length ? [es[0].from, ...es.map((e) => e.to)] : [i.sp];
    for (const v of candidates) if (num(v) !== null) return num(v);
    return num(i.sp);
  };
  const transitions = (i: Issue) => evs(i, 'status')
    .map((e) => ({ t: e.t, from: norm(e.from), to: norm(e.to) }))
    .filter((e) => e.from !== e.to);

  const aliasHits = new Map<string, { count: number; keys: Set<string> }>();
  for (const i of issues) {
    for (const e of evs(i, 'status')) {
      if (e.to && config.statusAliases[e.to]) {
        const hit = aliasHits.get(e.to) || { count: 0, keys: new Set<string>() };
        hit.count++;
        hit.keys.add(i.key);
        aliasHits.set(e.to, hit);
      }
    }
  }

  const model: Entry[] = [];
  const excluded: ExcludedIssue[] = [];
  const exclude = (i: Issue, assignee: string | null, sp: number | null, reason: ExcludedIssue['reason']) => {
    excluded.push({ key: i.key, summary: i.summary, assignee, status: i.status, sp, reason });
  };
  const prefix = label.replace(/\d+$/, '');
  let noSprintLabel = 0;
  for (const i of issues) {
    if (!i.labels.includes(label)) { noSprintLabel++; continue; }
    const J = Math.max(T0, i.createdT, joinTime(i));
    const statusStart = norm(valAt(i, 'status', Math.max(T0, i.createdT), i.status));
    const assignee = i.assignee;
    const sp = num(i.sp) ?? firstSP(i);
    const dev = assignee ? devByFull.get(assignee) : undefined;
    if (!sprintsAt(i, CUTOFF).includes(window.name)) { exclude(i, assignee, sp, 'removed-from-sprint'); continue; }
    if (!dev) { exclude(i, assignee, sp, 'not-in-roster'); continue; }
    const endStatus = norm(valAt(i, 'status', CUTOFF, i.status));
    const startBucket = BUCKET[statusStart];
    const endBucket = BUCKET[endStatus];
    if (!startBucket || !endBucket) { exclude(i, assignee, sp, 'unknown-status'); continue; }
    const labelled = new Set(i.labels.filter((l) => l.startsWith(prefix)).map((l) => Number(l.slice(prefix.length))));
    const carried = sprintsAt(i, J).some((name) => {
      const earlier = Number((name.match(/(\d+)\s*$/) || [0, NaN])[1]);
      return name !== window.name && earlier < sprintNum && labelled.has(earlier);
    });
    model.push({
      issue: i, summary: i.summary, joinedAfterStart: J > T0, startStatus: statusStart, startBucket, endStatus, endBucket,
      sp: sp ?? 0, cls: carried ? 'carry' : i.type === 'Bug' ? 'bug' : 'alloc', dev, tr: transitions(i), gate: {},
    });
  }
  const devKeys = rosterKeys.filter((d) => model.some((m) => m.dev.short === d));
  const byKey = new Map(model.map((m) => [m.issue.key, m]));
  const inWin = (t: number) => t >= T0 && t <= CUTOFF;
  const ref = (m: Entry): IssueRef => ({ key: m.issue.key, summary: m.summary });

  const totals = { alloc: 0, carry: 0, bug: 0 };
  model.forEach((m) => { totals[m.cls] += m.sp; });
  const totalSP = totals.alloc + totals.carry + totals.bug;
  const doneSP = sum(model.filter((m) => m.endBucket === 'Done').map((m) => m.sp));
  const endSum = (buckets: Bucket[]) => sum(model.filter((m) => buckets.includes(m.endBucket)).map((m) => m.sp));
  const nDev = new Set(model.map((m) => m.dev.short)).size;

  const startRows: StartRow[] = [];
  const endRows: EndRow[] = [];
  for (const d of devKeys) {
    const mine = model.filter((m) => m.dev.short === d);
    const buckets = emptyBuckets();
    const endBuckets = emptyBuckets();
    for (const b of BUCKETS) {
      buckets[b] = sum(mine.filter((m) => m.startBucket === b).map((m) => m.sp));
      endBuckets[b] = sum(mine.filter((m) => m.endBucket === b).map((m) => m.sp));
    }
    const total = sum(mine.map((m) => m.sp));
    const eligible = mine.filter((m) => m.startBucket !== 'RFP' && m.startBucket !== 'Done');
    const eligSP = sum(eligible.map((m) => m.sp));
    const compSP = sum(eligible.filter((m) => m.endBucket === 'RFP' || m.endBucket === 'Done').map((m) => m.sp));
    const inDev = endBuckets.Todo + endBuckets.InP + endBuckets.PR;
    const review = total - inDev;
    const load = total / loadTarget;
    const completion = eligSP ? compSP / eligSP : null;
    const velocity = total ? review / total : null;
    startRows.push({ dev: d, buckets, total, load, loadTone: toneLoad(load, loadTarget) });
    endRows.push({
      dev: d, buckets: endBuckets, total, eligSP, compSP, completion,
      completionTone: completion === null ? null : toneCompletion(completion),
      carryover: total - endBuckets.Done, inDev, review, velocity,
      velocityTone: velocity === null ? null : toneVelocity(velocity),
      carrySP: sum(mine.filter((m) => m.cls === 'carry').map((m) => m.sp)),
      bugSP: sum(mine.filter((m) => m.cls === 'bug').map((m) => m.sp)),
    });
  }

  function gate(entryStatus: string, backTo: string[], passed: (m: Entry) => boolean, tone: (p: number) => Tone): GateRow[] {
    return devKeys.map((d) => {
      let passedSP = 0, reworked = 0, pending = 0, scopeSP = 0;
      const challenging: Array<{ m: Entry; sp: number }> = [];
      for (const m of model.filter((x) => x.dev.short === d)) {
        const entries = m.tr.filter((x) => x.to === entryStatus && inWin(x.t));
        if (!entries.length) continue;
        const pushes = m.tr.filter((x) => x.from === entryStatus && backTo.includes(x.to) && inWin(x.t));
        scopeSP += m.sp;
        if (pushes.length) { reworked += m.sp; challenging.push({ m, sp: m.sp }); m.gate[entryStatus] = 'reworked'; }
        else if (passed(m)) { passedSP += m.sp; m.gate[entryStatus] = 'passed'; }
        else {
          pending += m.sp;
          m.gate[entryStatus] = 'pending';
          challenging.push({ m, sp: m.sp });
        }
      }
      challenging.sort((a, b) => b.sp - a.sp || a.m.issue.key.localeCompare(b.m.issue.key));
      const rate = (passedSP + reworked) ? passedSP / (passedSP + reworked) : null;
      return {
        dev: d, passed: passedSP, reworked, pending, scopeSP, rate, rateTone: rate === null ? null : tone(rate),
        challenging: challenging.map((c) => ref(c.m)),
      };
    });
  }
  const pr = gate('PR Review', ['To Do', 'In Progress'], (m) => RANK[m.endStatus] >= RANK['UAT MERGED'], tonePR);
  const qa = gate('UAT CHECK', ['UAT BUG / Improvement'], (m) => m.endStatus === 'ReadyForProduction' || m.endStatus === 'Done / MERGED', toneQA);

  const passEvents: Array<{ key: string; reviewer: string; t: number }> = [];
  const nonSelfPass: Array<{ key: string; token: string; by: string | null }> = [];
  for (const i of issues) {
    for (const e of evs(i, 'labels')) {
      const from = new Set((e.from || '').split(/\s+/).filter(Boolean));
      const to = new Set((e.to || '').split(/\s+/).filter(Boolean));
      for (const x of to) {
        const owner = devByToken.get(x);
        if (from.has(x) || !owner) continue;
        if (e.by === owner.full) passEvents.push({ key: i.key, reviewer: owner.short, t: e.t });
        else nonSelfPass.push({ key: i.key, token: x, by: e.by });
      }
    }
  }
  passEvents.sort((a, b) => a.t - b.t);

  const rev = new Map(rosterKeys.map((d) => [d, {
    issues: new Set<string>(), sp: 0, durs: [] as number[], failed: new Set<string>(), failedSP: 0, noDur: 0,
  }]));
  let prePassIgnored = 0;
  for (const p of passEvents) {
    const m = byKey.get(p.key);
    if (!m) continue;
    if (p.t < T0) { prePassIgnored++; continue; }
    if (p.t > CUTOFF) continue;
    const r = rev.get(p.reviewer)!;
    if (r.issues.has(p.key)) continue;
    r.issues.add(p.key);
    r.sp += m.sp;
    const entry = m.tr.filter((x) => x.to === 'PR Review' && x.t <= p.t).pop();
    if (entry) r.durs.push(wdays(entry.t, p.t));
    else r.noDur++;
  }
  let unattributedSP = 0;
  const unattributed = new Set<string>();
  for (const m of model) {
    for (const x of m.tr) {
      if (x.from === 'UAT CHECK' && x.to === 'UAT BUG / Improvement' && inWin(x.t)) {
        const prev = passEvents.filter((p) => p.key === m.issue.key && p.t < x.t).pop();
        if (prev) {
          const r = rev.get(prev.reviewer)!;
          if (!r.failed.has(m.issue.key)) { r.failed.add(m.issue.key); r.failedSP += m.sp; }
        } else if (!unattributed.has(m.issue.key)) { unattributed.add(m.issue.key); unattributedSP += m.sp; }
      }
    }
  }
  const reviewers: ReviewerRow[] = rosterKeys.map((d) => {
    const r = rev.get(d)!;
    const failRate = r.sp ? r.failedSP / r.sp : null;
    const avg = mean(r.durs);
    return {
      dev: d, issues: r.issues.size, sp: r.sp, failedSP: r.failedSP, failRate,
      failTone: failRate === null ? null : toneFail(failRate),
      bounced: [...r.failed].map((k) => ref(byKey.get(k)!)),
      avg, avgTone: avg === null ? null : toneReviewDays(avg),
      max: r.durs.length ? Math.max(...r.durs) : null,
      breaches: r.durs.filter((x) => x > slaDays).length, noDuration: r.noDur,
    };
  }).filter((r) => r.issues > 0).sort((a, b) => b.sp - a.sp || a.dev.localeCompare(b.dev));
  const teamAvgSP = mean(reviewers.map((r) => r.sp));

  const stageDur = new Map(devKeys.map((d) => [d, Object.fromEntries(STAGES.map(([k]) => [k, [] as number[]])) as Record<StageName, number[]>]));
  const winEnd = window.state === 'closed' ? CUTOFF : dayStart(CUTOFF) + 86400000 - 1000;
  for (const m of model) {
    const perStage = new Map<StageName, number>();
    const add = (stage: StageName, from: number, to: number) => perStage.set(stage, (perStage.get(stage) || 0) + wdays(from, to));
    let cur = m.tr.length ? m.tr[0].from : m.endStatus;
    let enter = m.issue.createdT;
    for (const x of m.tr.filter((t) => t.t <= winEnd)) {
      const stage = STAGES.find((s) => s[1] === cur);
      if (stage && x.t >= T0) add(stage[0], Math.max(enter, T0), x.t);
      cur = x.to;
      enter = x.t;
    }
    const open = STAGES.find((s) => s[1] === cur);
    if (open && enter <= winEnd) add(open[0], enter, winEnd);
    for (const [stage, days] of perStage) stageDur.get(m.dev.short)![stage].push(days);
  }
  const stageRows: StageRow[] = devKeys.map((d) => ({
    dev: d,
    stages: Object.fromEntries(STAGES.map(([k]) => {
      const avg = mean(stageDur.get(d)![k]);
      return [k, avg === null ? null : { value: avg, tone: toneStage(avg, k === 'RFP') }];
    })) as Record<StageName, Toned<number> | null>,
  }));

  const flags: Flag[] = [];
  const metricIdx = ['load', 'completion', 'vel', 'pr', 'qa', 'fail', 'revdur', 'spreviewed', 'carry', 'bug', 'In Progress', 'PR Review', 'UAT MERGED', 'UAT CHECK', 'blue'];
  const addFlag = (sev: Flag['sev'], dev: string, metric: string, desc: string) => flags.push({ sev, dev, metric, desc });
  const pct = (x: number) => roundHalfEven(x * 100);
  const fmt = (n: number) => String(round2(n));
  for (const d of devKeys) {
    const s = startRows.find((r) => r.dev === d)!;
    const e = endRows.find((r) => r.dev === d)!;
    const p = pr.find((r) => r.dev === d)!;
    const q = qa.find((r) => r.dev === d)!;
    if (s.load * loadTarget > 26) addFlag('R', d, 'load', `Load ${fmt(s.total)} SP (severely over target)`);
    else if (s.load > 4 / 3) addFlag('A', d, 'load', `Load ${fmt(s.total)} SP (${pct(s.load)}% of target)`);
    if (e.completion !== null && e.completion < 0.4) addFlag('R', d, 'completion', `Completion ${pct(e.completion)}% — little of the eligible load reached RFP/Done this sprint`);
    if (e.velocity !== null) {
      if (e.velocity < 0.5) addFlag('R', d, 'vel', `Dev velocity ${pct(e.velocity)}% (critical)`);
      else if (e.velocity < 0.8) addFlag('A', d, 'vel', `Dev velocity ${pct(e.velocity)}%`);
    }
    if (p.rate !== null) {
      if (p.rate < 0.5) addFlag('R', d, 'pr', `PR pass rate ${pct(p.rate)}% (critical)`);
      else if (p.rate < 0.7) addFlag('A', d, 'pr', `PR pass rate ${pct(p.rate)}%`);
    }
    if (q.rate !== null) {
      if (q.rate < 0.5) addFlag('R', d, 'qa', `QA pass rate ${pct(q.rate)}% (critical)`);
      else if (q.rate < 0.7) addFlag('A', d, 'qa', `QA pass rate ${pct(q.rate)}%`);
    }
    const rr = reviewers.find((r) => r.dev === d);
    if (rr) {
      if (rr.failRate !== null) {
        if (rr.failRate >= 0.5) addFlag('R', d, 'fail', `Review fail rate ${pct(rr.failRate)}% (critical)`);
        else if (rr.failRate >= 0.3) addFlag('A', d, 'fail', `Review fail rate ${pct(rr.failRate)}%`);
      }
      if (rr.avg !== null) {
        if (rr.avg > 4) addFlag('R', d, 'revdur', `Review duration ${rr.avg.toFixed(1)}d avg (far over SLA)`);
        else if (rr.avg > 2) addFlag('A', d, 'revdur', `Review duration ${rr.avg.toFixed(1)}d avg`);
      }
      if (teamAvgSP !== null && rr.sp < 0.5 * teamAvgSP) addFlag('A', d, 'spreviewed', `SP reviewed ${fmt(rr.sp)} (below 50% of team avg ${Math.round(teamAvgSP)})`);
    }
    if (e.carrySP > bugMarginPerDev) addFlag('A', d, 'carry', `High incoming carryover ${fmt(e.carrySP)} SP`);
    if (e.bugSP > bugMarginPerDev) addFlag('A', d, 'bug', `Bug SP ${fmt(e.bugSP)} — margin blown`);
    const stageRow = stageRows.find((r) => r.dev === d)!;
    for (const [stageKey, statusLabel] of [['In Progress', 'In Progress'], ['PR Review', 'PR Review'], ['UAT Merged', 'UAT MERGED'], ['UAT Check', 'UAT CHECK']] as Array<[StageName, string]>) {
      const v = stageRow.stages[stageKey]?.value;
      if (v === undefined) continue;
      if (v > 4) addFlag('R', d, statusLabel, `${statusLabel} avg ${v.toFixed(1)}d (far over SLA)`);
      else if (v > 2) addFlag('A', d, statusLabel, `${statusLabel} avg ${v.toFixed(1)}d`);
    }
    if (e.velocity !== null && p.rate !== null && q.rate !== null && e.velocity >= 0.85 && p.rate >= 0.85 && q.rate >= 0.85) {
      addFlag('B', d, 'blue', `Consistent high performer (vel ${pct(e.velocity)}%, PR ${pct(p.rate)}%, QA ${pct(q.rate)}%)`);
    }
  }
  const sevRank = { R: 0, A: 1, B: 2 };
  flags.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || devKeys.indexOf(a.dev) - devKeys.indexOf(b.dev) || metricIdx.indexOf(a.metric) - metricIdx.indexOf(b.metric));

  const earlyPushBacks = model.flatMap((m) => m.tr
    .filter((x) => x.from === 'PR Review' && ['To Do', 'In Progress'].includes(x.to) && x.t >= T0 && x.t - T0 < 3600000)
    .map((x) => `${m.issue.key} at ${new Date(x.t + tzMs).toISOString().slice(11, 19)}`));
  const cutoffIso = new Date(CUTOFF).toISOString();

  return {
    rulesVersion: RULES_VERSION,
    sprint: { id: window.id, name: window.name, label, num: sprintNum, state: window.state, start: window.start, end: window.end },
    cutoff: cutoffIso,
    roster,
    overview: {
      developers: nDev, totalSP, allocated: totals.alloc, carryover: totals.carry, bugSP: totals.bug, doneSP,
      targetSP: nDev * targetPerDev, bugMargin: nDev * bugMarginPerDev, loadTarget,
      pipeline: {
        inDev: endSum(['Todo', 'InP', 'PR']), uatMerged: endSum(['UATM']), uatCheckRfp: endSum(['UATC', 'RFP']),
        uatBug: endSum(['UATB']), done: endSum(['Done']),
      },
    },
    start: startRows,
    end: endRows,
    pr,
    qa,
    reviewers,
    unattributedSP,
    teamAvgSPReviewed: teamAvgSP,
    stages: stageRows,
    flags,
    notes: {
      addedAfterStart: model.filter((m) => m.joinedAfterStart).length,
      noSprintEvents: issues.filter((i) => !evs(i, 'Sprint').length).length,
      noSprintLabel,
      nonSelfPass,
      prePassIgnored,
      passWithoutDuration: reviewers.reduce((a, r) => a + r.noDuration, 0),
      revertedToUatMerged: model.filter((m) => m.tr.some((x) => x.from === 'UAT CHECK' && x.to === 'UAT MERGED' && inWin(x.t))).length,
      earlyPushBacks,
      aliasHits: [...aliasHits].map(([status, hit]) => ({ status, count: hit.count, keys: [...hit.keys].sort() })),
      excluded,
    },
  };
}

export function buildTrend(results: SprintResult[]): SprintTrend {
  const ordered = [...results].sort((a, b) => Date.parse(a.sprint.start) - Date.parse(b.sprint.start));
  const recent = ordered.slice(-2);
  const roster = new Map<string, RosterMember>();
  ordered.forEach((r) => r.roster.forEach((m) => roster.set(m.short, m)));
  const hasLoad = (r: SprintResult, dev: string) => (r.end.find((row) => row.dev === dev)?.total || 0) > 0;
  const series = [...roster.values()]
    .filter((m) => recent.some((r) => hasLoad(r, m.short)))
    .map((m) => ({
      dev: m.short,
      color: m.color || null,
      data: ordered.map((r) => {
        const velocity = r.end.find((row) => row.dev === m.short)?.velocity;
        return velocity === null || velocity === undefined ? null : round2(velocity * 100);
      }),
    }));
  return { labels: ordered.map((r) => r.sprint.label), series };
}
