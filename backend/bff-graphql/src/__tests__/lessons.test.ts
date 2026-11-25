import assert from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  findSimilar, judgeSessionSources, judgeSprintSources, ledgerSources, lessonsLine, ownerCorrectionSource, similarText, targetFile, ticketFile, ticketRepos,
  type LessonRow, type SourceInput, type SourceRow,
} from '../integrations/lessons';
import { LessonService, type LessonDeps, type LessonStore } from '../integrations/lesson-service';
import { importLessons } from '../integrations/lessons-import';
import { parseJudgeResult, judgeSessionPrompt } from '../integrations/judge';
import { confirmedPrompt, ownerReplyPrompt, resumePrompt, sousConfirmedPrompt, sousStartPrompt, startPrompt } from '../integrations/orchestrator-cron';
import { reviewPrompt } from '../integrations/auto-review';
import { findingsPrompt } from '../integrations/review-findings';
import { qaPrompt, revisionPrompt } from '../integrations/qa-local';
import { scoutPrompt } from '../integrations/scout';
import { flowRuleLines, readFlowRules } from '../integrations/sous-flow';
import { protectedMutations, protectedQueries, resolvers } from '../resolvers';
import { buildASTSchema, graphql } from 'graphql';
import { typeDefs } from '../schema/typeDefs';

const NOW = new Date('2026-11-25T03:00:00Z');
const FILE = '/home/coder/projects/.evidence/lessons/QRD-1592.md';

function memoryStore() {
  const sources: SourceRow[] = [];
  const lessons: LessonRow[] = [];
  const cache = new Map<string, unknown>();
  let tick = 0;
  const stamp = () => new Date(NOW.getTime() + (tick += 1000));
  const store: LessonStore = {
    addLessonSource: async (input) => {
      if (sources.some((row) => row.ref === input.ref)) return null;
      const row: SourceRow = { id: randomUUID(), kind: input.kind, ref: input.ref, sessionId: input.sessionId ?? null, messageId: input.messageId ?? null, sprint: input.sprint ?? null, ticketKey: input.ticketKey ?? null, text: input.text, cause: input.cause, shouldHave: input.shouldHave ?? '', targetKind: input.targetKind ?? null, targetName: input.targetName ?? null, lesson: input.lesson ?? null, lessonTextId: input.lessonTextId ?? null, status: 'pending', lessonId: null, error: null, createdAt: stamp(), processedAt: null };
      sources.push(row);
      return row;
    },
    getLessonSources: async (where = {}) => sources.filter((row) => (!where.statuses || where.statuses.includes(row.status)) && (!where.lessonIds || (row.lessonId !== null && where.lessonIds.includes(row.lessonId)))),
    updateLessonSource: async (id, data) => Object.assign(sources.find((row) => row.id === id)!, data),
    getLessons: async (where = {}) => lessons.filter((row) => !where.statuses || where.statuses.includes(row.status)).map((row) => ({ ...row })),
    getLesson: async (id) => { const row = lessons.find((item) => item.id === id); return row ? { ...row } : null; },
    createLesson: async (data) => {
      const row: LessonRow = { id: randomUUID(), textId: null, count: 1, ignored: 0, ticketKeys: '[]', sessionIds: '[]', status: 'active', cardKey: null, cardState: null, cardSessionId: null, noticeAt: null, createdAt: stamp(), updatedAt: stamp(), ...data } as LessonRow;
      lessons.push(row);
      return { ...row };
    },
    updateLesson: async (id, data) => { const row = lessons.find((item) => item.id === id)!; Object.assign(row, data, { updatedAt: stamp() }); return { ...row }; },
    getCache: async (namespace, key) => cache.get(`${namespace}:${key}`) ?? null,
    upsertCache: async (namespace, key, value) => { cache.set(`${namespace}:${key}`, value); },
  };
  return { store, sources, lessons, cache };
}

function world(over: Partial<LessonDeps> = {}) {
  const memory = memoryStore();
  const root = mkdtempSync(path.join(os.tmpdir(), 'dock-lessons-'));
  const kit: Array<{ kind: string; name: string; text: string }> = [];
  const notices: Array<{ title: string; tag: string }> = [];
  const files = new Map<string, string>();
  const cards: Array<{ key: string; prompt: string }> = [];
  let flow: string[] = [];
  let kitDown = false;
  const deps: LessonDeps = {
    store: memory.store,
    now: () => NOW,
    evidenceRoot: () => root,
    writeKitFile: async (kind, name, text) => { if (kitDown) throw new Error('bridge offline'); kit.push({ kind, name, text }); },
    writeFlowRules: async (lines) => { flow = lines; },
    writeFile: async (file, text) => { const key = file.replace(/\\/g, '/'); if (files.get(key) === text) return false; files.set(key, text); return true; },
    ticketFiles: async () => [...files.keys()].map((file) => path.posix.basename(file, '.md')).filter((name) => /^[A-Z]+-\d+$/.test(name)),
    ticketRepos: async () => ['ms-admin-worker-backend'],
    notify: async (notice) => { notices.push(notice); },
    startCard: async (key, prompt) => { cards.push({ key, prompt }); return 'card-session'; },
    ...over,
  };
  const service = new LessonService(deps);
  return { ...memory, service, kit, notices, files, cards, root, flowRules: () => flow, setKitDown: (down: boolean) => { kitDown = down; }, done: () => rmSync(root, { recursive: true, force: true }) };
}

const finding = (over: Record<string, unknown> = {}) => ({ messageId: 76050, threadUrl: null, cause: 'self-inflicted-rework', text: 'Four ElevenLabs keys returned 401 and the video went to edge.', quote: 'q', shouldHave: 'Walk the whole ElevenLabs rotation.', call: 'mistake', target: { kind: 'skill', name: 'demo-video' }, lesson: 'Walk the whole ElevenLabs rotation (el-rotate get, park, get) before using edge.', ...over });
const FINAL = new Set(['lesson', 'merged', 'code', 'environment']);

test('every source kind enters the queue once per ref and ends in a final status', async () => {
  const w = world();
  try {
    const run = {
      key: 'QRD-1646', kind: 'build', stage: 'done', finished: true, prBe: 'https://github.com/qonekid/ms-admin-worker-backend/pull/12', prFe: null,
      failures: [{ at: '2026-11-24T01:00:00Z', type: 'defect', what: 'tsc -p tsconfig.migrations.json failed on scripts/', evidence: 'ci', attempt: 1 }, { at: '2026-11-24T02:00:00Z', type: 'env', what: 'Mongo down', evidence: 'x', attempt: 1 }],
      findings: [{ at: '2026-11-24T03:00:00Z', severity: 'blocker', text: 'impact() ignores pinnedVersion', resolvedAt: null }, { at: '2026-11-24T03:30:00Z', severity: 'nit', text: 'typo', resolvedAt: '2026-11-24T04:00:00Z' }],
      issues: [{ n: 2, type: 'QUESTION', text: 'Keep the old export?', level: 'owner' }, { n: 3, type: 'RISK', text: 'x', level: 'arbiter' }],
      decisions: [{ n: 1, text: 'Use the legacy table', status: 'SUPERSEDED', supersededBy: 4 }, { n: 4, text: 'Use the new table', status: 'DECIDED', supersededBy: null }],
      rounds: { used: 2, max: 2 }, closing: { fixRounds: 2 },
    };
    const inputs: SourceInput[] = [
      ...judgeSessionSources('4e75771b', 'QRD-1639', [finding(), finding({ cause: 'environment', text: 'The Atlassian MCP lacked a tool.', target: null, lesson: null }), finding({ call: 'not', text: 'Obeyed a hard ban.' })] as never),
      ...judgeSprintSources('QRD Sprint 28', [
        { kind: 'problem', text: 'Guard refusals went straight to the owner.', evidence: ['QA-QRD-1516 (a3c23286): BLOCKER I-8'], dest: 'note', source: 'judge' },
        { kind: 'try', text: 'Remember the local workflow PIN is 767676.', evidence: ['QRD-1300: asked for the PIN'], dest: 'memory', source: 'judge' },
        { kind: 'keep', text: 'Kept', evidence: ['QRD-1'], dest: 'note', source: 'judge' },
        { kind: 'try', text: 'Ledger line', evidence: ['QRD-2'], dest: 'kit', source: 'ledger' },
      ]),
      ...ledgerSources(run),
      ownerCorrectionSource('QRD-1700', { n: 2, text: 'No video for a BE-only ticket' }, 'Make the video through the UI'),
    ];
    assert.deepStrictEqual([...new Set(inputs.map((input) => input.kind))].sort(), ['judge-session', 'judge-sprint', 'ledger', 'owner-correction']);
    assert.strictEqual(inputs.filter((input) => input.kind === 'judge-session').length, 2, 'a finding Judge called not a mistake teaches nothing');
    assert.strictEqual(inputs.filter((input) => input.kind === 'judge-sprint').length, 2, 'only Problem and Try lines of the Judge summary');
    const ledgerRefs = inputs.filter((input) => input.ticketKey === 'QRD-1646').map((input) => input.ref.split(':').slice(0, 3).join(':'));
    assert.deepStrictEqual(ledgerRefs.sort(), ['decision:QRD-1646:D-1', 'ledger:QRD-1646:failure', 'ledger:QRD-1646:failure', 'ledger:QRD-1646:finding', 'ledger:QRD-1646:issue', 'ledger:QRD-1646:rounds'].sort(), 'a resolved finding and an arbiter issue stay out');

    const first = await w.service.ingest(inputs);
    assert.strictEqual(first.added, inputs.length);
    assert.ok(w.sources.every((row) => FINAL.has(row.status)), 'no source is left pending');
    assert.strictEqual((await w.service.overview()).unprocessed, 0);
    const again = await w.service.ingest(inputs);
    assert.strictEqual(again.added, 0, 'a source posted twice is kept once');
    const correction = await w.service.ingest([ownerCorrectionSource('QRD-1646', { n: 1, text: 'Use the legacy table' }, 'new table')]);
    assert.strictEqual(correction.added, 0, 'the owner correction of a superseded decision shares its ref');
  } finally { w.done(); }
});

test('environment becomes a notice and never a lesson', async () => {
  const w = world();
  try {
    await w.service.ingest(judgeSessionSources('s1', 'QRD-1', [finding({ cause: 'environment', text: 'Workspace OOM killed the turn.' })] as never));
    assert.strictEqual(w.sources[0].status, 'environment');
    assert.strictEqual(w.lessons.length, 0);
    assert.match(w.notices[0].title, /Environment on QRD-1/);
  } finally { w.done(); }
});

test('similar lessons merge: same target and cause, near-identical text, count and sources grow', async () => {
  assert.ok(similarText('Walk the whole ElevenLabs rotation before using edge.', 'walk the whole elevenlabs rotation, before using edge!'));
  assert.ok(!similarText('Walk the whole ElevenLabs rotation before using edge.', 'Run prettier on every changed file.'));
  const w = world();
  try {
    await w.service.ingest(judgeSessionSources('4e75771b', 'QRD-1639', [finding()] as never));
    assert.strictEqual(w.lessons.length, 1);
    assert.strictEqual(w.notices.length, 0, 'one sighting asks nothing');
    await w.service.ingest(judgeSessionSources('2fd63b1a', 'QRD-1592', [finding({ text: 'Again four keys 401, edge used.', lesson: 'Walk the whole ElevenLabs rotation (el-rotate get, park, get) before using edge!' })] as never));
    assert.strictEqual(w.lessons.length, 1, 'merged, not a second lesson');
    const lesson = w.lessons[0];
    assert.strictEqual(lesson.count, 2);
    assert.deepStrictEqual(JSON.parse(lesson.ticketKeys), ['QRD-1639', 'QRD-1592']);
    assert.deepStrictEqual(JSON.parse(lesson.sessionIds), ['4e75771b', '2fd63b1a']);
    assert.deepStrictEqual(w.sources.map((row) => row.status), ['lesson', 'merged']);
    const other = await w.service.ingest(judgeSessionSources('x', 'QRD-2', [finding({ cause: 'skipped-step', text: 'other cause' })] as never));
    assert.strictEqual(other.added, 1);
    assert.strictEqual(w.lessons.length, 2, 'another cause is another lesson');
    assert.strictEqual(findSimilar(w.lessons, { kind: 'skill', name: 'demo-video' }, 'lesson-ignored', lesson.text)?.id, lesson.id, 'lesson-ignored matches any cause');
  } finally { w.done(); }
});

test('a lesson seen twice, or broken after it was read, asks for a code card that waits for the owner', async () => {
  const w = world();
  try {
    await w.service.ingest(judgeSessionSources('a', 'QRD-1639', [finding()] as never));
    await w.service.ingest(judgeSessionSources('b', 'QRD-1592', [finding({ text: 'second' })] as never));
    const lesson = w.lessons[0];
    assert.strictEqual(lesson.status, 'code-card');
    assert.strictEqual(lesson.cardState, 'pending');
    assert.match(String(lesson.cardKey), /^CARD-lesson-demo-video-[a-z0-9]{6}$/);
    assert.match(w.notices[0].title, /Make it code\? skill demo-video/);
    assert.strictEqual(w.cards.length, 0, 'nothing starts without the owner');
    assert.ok(w.kit.at(-1)!.text.includes('Walk the whole ElevenLabs rotation'), 'a pending card stays a live lesson');

    assert.strictEqual(await w.service.remind(), 0, 'already told today');
    const later = new LessonService({ ...(w.service as unknown as { deps: LessonDeps }).deps, now: () => new Date(NOW.getTime() + 24 * 3600 * 1000) });
    assert.strictEqual(await later.remind(), 1, 'told again the next WIB day');

    const view = await w.service.approveCard(lesson.id);
    assert.strictEqual(view.cardState, 'started');
    assert.strictEqual(view.cardSessionId, 'card-session');
    assert.strictEqual(w.cards[0].key, lesson.cardKey);
    assert.match(w.cards[0].prompt, new RegExp(`^Pakai skill sous: kerjakan ${lesson.cardKey}\\.\\nPelajaran: .*${lesson.cardKey}\\.md`));
    await assert.rejects(w.service.approveCard(lesson.id), /running already/);
    assert.strictEqual(await w.service.cardFinished({ key: String(lesson.cardKey), stage: 'done', finished: true }), true);
    assert.strictEqual(w.lessons[0].status, 'coded');
    assert.ok(!w.kit.at(-1)!.text.includes('Walk the whole'), 'a coded lesson leaves the files');

    const v = world();
    await v.service.ingest(judgeSessionSources('c', 'QRD-1700', [finding({ cause: 'lesson-ignored', text: 'Used edge after reading the lesson.' })] as never));
    assert.strictEqual(v.lessons[0].ignored, 1);
    assert.strictEqual(v.lessons[0].cardState, 'pending', 'broken once after reading is enough');
    assert.strictEqual(v.cards.length, 0);
    v.done();

    const code = world();
    await code.service.ingest(judgeSessionSources('d', 'QRD-1', [finding({ target: { kind: 'code', name: 'tts.py' } })] as never));
    assert.deepStrictEqual([code.sources[0].status, code.lessons[0].status, code.lessons[0].cardState], ['code', 'code-card', 'pending']);
    code.done();
  } finally { w.done(); }
});

test('lessons are written to their targets, and a write the bridge missed is retried', async () => {
  const w = world();
  try {
    w.setKitDown(true);
    await w.service.ingest([
      ...judgeSessionSources('a', 'QRD-1', [
        finding(),
        finding({ cause: 'skipped-step', text: 'runner ended the turn', target: { kind: 'agent', name: 'sous-review-runner' }, lesson: 'Wait for the reviewer agent in the foreground.' }),
        finding({ cause: 'skipped-step', text: 'pr body', target: { kind: 'flow', name: 'anything' }, lesson: 'After the video is replaced, edit the PR body through sous-publisher.' }),
        finding({ cause: 'wrong-code', text: 'ci', target: { kind: 'repo', name: 'MS-ADMIN-WORKER-BACKEND' }, lesson: 'Run tsc -p tsconfig.migrations.json --noEmit when scripts/ types change.' }),
        finding({ cause: 'asked-instead-of-looking', text: 'pin', target: { kind: 'fact', name: 'local-stack' }, lesson: 'The local workflow PIN is 767676.' }),
      ] as never),
    ]);
    assert.strictEqual(w.kit.length, 0);
    assert.deepStrictEqual((w.cache.get('lessons:dirty') as string[]).sort(), ['agent:sous-review-runner', 'skill:demo-video']);
    assert.deepStrictEqual(w.flowRules(), ['After the video is replaced, edit the PR body through sous-publisher.']);
    assert.match(w.files.get(`${w.root.replace(/\\/g, '/')}/lessons/ms-admin-worker-backend.md`) ?? '', /# Pelajaran ms-admin-worker-backend[\s\S]*- \(1×, QRD-1\) Run tsc/);
    assert.match(w.files.get(`${w.root.replace(/\\/g, '/')}/lessons/facts.md`) ?? '', /PIN is 767676/);
    w.setKitDown(false);
    await w.service.writeOut();
    assert.deepStrictEqual(w.kit.map((item) => `${item.kind}:${item.name}`).sort(), ['agent:sous-review-runner', 'skill:demo-video']);
    assert.match(w.kit.find((item) => item.kind === 'skill')!.text, /^# Pelajaran demo-video\n\nDibaca sebelum langkah pertama[\s\S]*- \(1×, QRD-1\) Walk the whole ElevenLabs rotation/);
    assert.deepStrictEqual(w.cache.get('lessons:dirty'), []);
    assert.strictEqual((await w.service.overview()).lessons.find((item) => item.targetKind === 'agent')!.writtenTo, 'kit/lessons/agents/sous-review-runner.md', 'agent lessons stay out of agents/');

    const lesson = w.lessons.find((item) => item.targetKind === 'flow')!;
    await w.service.edit(lesson.id, '  Edit the PR body after a new video.  ');
    assert.deepStrictEqual(w.flowRules(), ['Edit the PR body after a new video.']);
    const moved = await w.service.retarget(lesson.id, 'skill', 'sous');
    assert.strictEqual(moved.writtenTo, 'skills/sous/lessons.md');
    assert.deepStrictEqual(w.flowRules(), [], 'the old target is written again without it');
    assert.match(w.kit.at(-1)!.text, /Edit the PR body after a new video/);
    await assert.rejects(w.service.retarget(lesson.id, 'team', 'x'), /target kind/);
    await assert.rejects(w.service.edit(lesson.id, ' '), /one sentence/);
    assert.strictEqual(await w.service.remove(lesson.id), true);
    assert.doesNotMatch(w.kit.at(-1)!.text, /Edit the PR body/);
    assert.ok(!(await w.service.overview()).lessons.some((item) => item.id === lesson.id), 'a deleted lesson leaves the list');
  } finally { w.done(); }
});

test('the per-ticket file holds every skill, agent, flow and fact lesson and the ticket repos, nothing cut; empty says so', async () => {
  const w = world();
  try {
    const empty = await w.service.prepareTicket('QRD-1592');
    assert.strictEqual(empty, `${w.root.replace(/\\/g, '/')}/lessons/QRD-1592.md`);
    assert.match(w.files.get(empty!)!, /^# Pelajaran QRD-1592[\s\S]*Belum ada pelajaran\./);
    const many = Array.from({ length: 12 }, (_, index) => finding({ text: `t${index}`, cause: `cause-${index}`, lesson: `Distinct lesson number ${index} about a step.` }));
    await w.service.ingest(judgeSessionSources('a', 'QRD-1', [
      ...many,
      finding({ cause: 'wrong-code', text: 'be', target: { kind: 'repo', name: 'ms-admin-worker-backend' }, lesson: 'BE repo lesson.' }),
      finding({ cause: 'wrong-code', text: 'fe', target: { kind: 'repo', name: 'ms-client-dashboard-frontend' }, lesson: 'FE repo lesson.' }),
      finding({ cause: 'skipped-step', text: 'a', target: { kind: 'agent', name: 'sous-publisher' }, lesson: 'Agent lesson.' }),
      finding({ cause: 'skipped-step', text: 'f', target: { kind: 'flow', name: 'sous' }, lesson: 'Flow lesson.' }),
      finding({ cause: 'skipped-step', text: 'k', target: { kind: 'fact', name: 'x' }, lesson: 'Fact lesson.' }),
    ] as never));
    const text = w.files.get(empty!)!;
    for (let index = 0; index < 12; index += 1) assert.ok(text.includes(`Distinct lesson number ${index}`), `lesson ${index} is not cut`);
    assert.match(text, /## Skill demo-video[\s\S]*## Agent sous-publisher[\s\S]*## Sous flow[\s\S]*## Repo ms-admin-worker-backend[\s\S]*## Fakta lingkungan/);
    assert.ok(text.includes('BE repo lesson.') && !text.includes('FE repo lesson.'), 'only the ticket repos');
    const all = ticketFile('QRD-9', [], w.lessons);
    assert.ok(all.includes('FE repo lesson.') && all.includes('BE repo lesson.'), 'no known repo: every repo lesson');
    const before = w.files.get(empty!);
    await w.service.prepareTicket('QRD-1592');
    assert.strictEqual(w.files.get(empty!), before, 'unchanged lessons leave the file as it was');
  } finally { w.done(); }
});

test('ticket repos come from pull request links and the owner-fe / owner-be labels', () => {
  assert.deepStrictEqual(ticketRepos({ prBe: 'https://github.com/qonekid/ms-admin-worker-backend/pull/1', prFe: null }, []), ['ms-admin-worker-backend']);
  assert.deepStrictEqual(ticketRepos(null, ['owner-fe-be']), ['ms-admin-worker-backend', 'ms-client-dashboard-frontend']);
  assert.deepStrictEqual(ticketRepos(null, ['OWNER-FE']), ['ms-client-dashboard-frontend']);
  assert.deepStrictEqual(ticketRepos({ pullRequests: [{ url: 'https://github.com/o/qonflo-chat-widget/pull/3' }] }, ['owner-be']), ['ms-admin-worker-backend', 'qonflo-chat-widget']);
  assert.match(targetFile('skill', 'x', []), /- Belum ada pelajaran\./);
});

test('each prompt builder carries the one Pelajaran line on its own line, and none without a file', () => {
  const line = lessonsLine(FILE);
  assert.strictEqual(line, `Pelajaran: ${FILE} — baca file ini sebelum mulai; guard menolak Edit, Write dan git commit sampai file ini dibaca.`);
  const prompts: Array<[string, string, string]> = [
    ['startPrompt', startPrompt('QRD-1592', FILE), startPrompt('QRD-1592')],
    ['confirmedPrompt', confirmedPrompt('QRD-1592', FILE), confirmedPrompt('QRD-1592')],
    ['resumePrompt omc', resumePrompt('QRD-1592', 'omc', FILE), resumePrompt('QRD-1592', 'omc')],
    ['resumePrompt sous', resumePrompt('QRD-1592', 'sous', FILE), resumePrompt('QRD-1592', 'sous')],
    ['sousStartPrompt', sousStartPrompt('QRD-1592', null, ['Sous flow rule: x'], FILE), sousStartPrompt('QRD-1592', null, ['Sous flow rule: x'])],
    ['sousConfirmedPrompt', sousConfirmedPrompt('QRD-1592', null, [], FILE), sousConfirmedPrompt('QRD-1592')],
    ['ownerReplyPrompt', ownerReplyPrompt('QRD-1592', 'Jawaban owner: go', FILE), ownerReplyPrompt('QRD-1592', 'Jawaban owner: go')],
    ['reviewPrompt', reviewPrompt('QRD-1592', ['https://github.com/o/r/pull/1'], 'https://discord.com/t', null, FILE), reviewPrompt('QRD-1592', ['https://github.com/o/r/pull/1'], 'https://discord.com/t')],
    ['findingsPrompt', findingsPrompt({ key: 'QRD-1592', threadUrl: 'u', threadId: '1', roundId: 'r1', prUrls: ['p'], since: 's', blocks: ['b'], lessons: FILE }), findingsPrompt({ key: 'QRD-1592', threadUrl: 'u', threadId: '1', roundId: 'r1', prUrls: ['p'], since: 's', blocks: ['b'] })],
    ['qaPrompt', qaPrompt('QRD-1592', ['p'], FILE), qaPrompt('QRD-1592', ['p'])],
    ['revisionPrompt', revisionPrompt('QRD-1592', 1, { runId: 'r', tcs: [] }, '/d', FILE), revisionPrompt('QRD-1592', 1, { runId: 'r', tcs: [] }, '/d')],
    ['scoutPrompt', scoutPrompt('QRD-1592', FILE), scoutPrompt('QRD-1592')],
  ];
  for (const [name, withFile, without] of prompts) {
    assert.strictEqual(withFile.split('\n').filter((item) => item === line).length, 1, `${name}: one line, on its own`);
    assert.strictEqual(withFile.replace(`\n${line}`, ''), without, `${name}: the rest of the prompt is unchanged`);
    assert.doesNotMatch(without, /Pelajaran:/, `${name}: no line without a file`);
  }
  assert.strictEqual(judgeSessionPrompt('s1', '/in.md', 9, FILE), `Pakai skill judge: session s1 input /in.md until 9 lessons ${FILE}`);
  assert.strictEqual(judgeSessionPrompt('s1', '/in.md', null), 'Pakai skill judge: session s1 input /in.md until -');
  assert.deepStrictEqual(flowRuleLines(readFlowRules(JSON.stringify(['Edit the PR body.', ' ', 3]))), ['Sous flow rule: Edit the PR body.']);
  assert.deepStrictEqual(readFlowRules('not json'), []);
});

test('a Judge result carries target and lesson and the new cause; an old result still parses; environment drops them', () => {
  const result = parseJudgeResult({ sessionId: 'abc', untilMessageId: '-', findings: [
    finding(),
    finding({ cause: 'lesson-ignored' }),
    finding({ cause: 'environment' }),
    { messageId: 1, cause: 'skipped-step', text: 'old', quote: '', shouldHave: '', call: 'mistake' },
    finding({ target: { kind: 'team', name: 'x' } }),
  ] });
  assert.deepStrictEqual(result.findings.map((item) => [item.cause, item.target?.kind ?? null, item.lesson !== null]), [
    ['self-inflicted-rework', 'skill', true], ['lesson-ignored', 'skill', true], ['environment', null, false], ['skipped-step', null, false], ['self-inflicted-rework', null, false],
  ]);
});

test('the importer reads Judge results, Judge sprint summaries and closed ledgers of the sprints from fixture files', async () => {
  const w = world();
  const evidence = mkdtempSync(path.join(os.tmpdir(), 'dock-import-'));
  try {
    mkdirSync(path.join(evidence, 'judge'));
    writeFileSync(path.join(evidence, 'judge', '4e75771b.json'), JSON.stringify({ sessionId: '4e75771b', untilMessageId: '-', findings: [finding(), finding({ cause: 'environment', text: 'quota' })], ownerWaitMinutes: 0 }));
    writeFileSync(path.join(evidence, 'judge', 'old.json'), JSON.stringify({ sessionId: 'old1', untilMessageId: 4, findings: [{ messageId: 1, cause: 'asked-instead-of-looking', text: 'Asked for the PIN memory holds.', quote: 'q', shouldHave: 'Enter PIN 767676 first.', call: 'mistake' }] }));
    writeFileSync(path.join(evidence, 'judge', 'broken.json'), '{');
    mkdirSync(path.join(evidence, 'retro'));
    writeFileSync(path.join(evidence, 'retro', 'qrd-sprint-28-judge.json'), JSON.stringify({ sprint: 'QRD Sprint 28', items: [{ kind: 'try', text: 'Hand guard refusals to the lead.', evidence: ['QA-QRD-1516 (a3c23286)'], dest: 'kit', source: 'judge' }] }));
    const ledger = (key: string, stage: string) => {
      mkdirSync(path.join(evidence, key));
      writeFileSync(path.join(evidence, key, 'status.json'), JSON.stringify({ key, title: key, stage, updatedAt: '2026-11-20T00:00:00Z', failures: [{ at: '2026-11-19T00:00:00Z', type: 'defect', what: `${key} broke`, evidence: 'e', attempt: 1 }], pr: { be: `https://github.com/qonekid/ms-admin-worker-backend/pull/${key.slice(4)}` } }));
    };
    ledger('QRD-2701', 'done');
    ledger('QRD-2702', 'pr');
    ledger('QRD-2801', 'done');
    ledger('QRD-9999', 'done');
    const log: string[] = [];
    const result = await importLessons({ evidence, sprints: ['QRD Sprint 27', 'QRD Sprint 28'], service: w.service, sprintKeys: async (name) => (name.endsWith('27') ? ['QRD-2701', 'QRD-2702'] : ['QRD-2801']), ticketOf: async (id) => (id === '4e75771b' ? 'QRD-1639' : null), log: (line) => log.push(line) });
    assert.deepStrictEqual(result, { files: 5, added: 6, processed: 6, unprocessed: 0 });
    assert.ok(log.some((line) => line.includes('broken.json')) && log.some((line) => line.includes('QRD-2702') && line.includes('not closed')));
    assert.ok(!w.sources.some((row) => row.ticketKey === 'QRD-9999'), 'a ledger of another sprint stays out');
    assert.strictEqual(w.sources.find((row) => row.sessionId === 'old1')!.status, 'lesson', 'an old result without a target becomes a sous flow lesson');
    assert.strictEqual(w.lessons.find((row) => row.text.includes('767676'))!.targetKind, 'flow');
    assert.strictEqual(w.sources.filter((row) => row.status === 'environment').length, 1);
    assert.strictEqual((await importLessons({ evidence, sprints: ['QRD Sprint 27'], service: w.service, sprintKeys: async () => ['QRD-2701'] })).added, 0, 'running it again adds nothing');
    assert.ok(w.lessons.some((row) => row.targetKind === 'repo' && row.targetName === 'ms-admin-worker-backend'));
    assert.match(readFileSync(path.join(evidence, 'judge', '4e75771b.json'), 'utf8'), /4e75771b/, 'the import only reads');
  } finally { w.done(); rmSync(evidence, { recursive: true, force: true }); }
});

test('a Judge lessonId becomes the lesson textId: a merge keeps or fills it, the owner edits it, files stay English', async () => {
  const parsed = parseJudgeResult({ sessionId: 'abc', untilMessageId: '-', findings: [
    finding({ lessonId: 'Coba semua key ElevenLabs dulu sebelum pakai edge.' }),
    finding({ lesson: null, lessonId: 'tanpa lesson' }),
    { messageId: 1, cause: 'skipped-step', text: 'old', quote: '', shouldHave: '', call: 'mistake', target: { kind: 'skill', name: 'demo-video' }, lesson: 'Old lesson.' },
  ] });
  assert.deepStrictEqual(parsed.findings.map((item) => item.lessonId), ['Coba semua key ElevenLabs dulu sebelum pakai edge.', null, null]);
  const w = world();
  try {
    await w.service.ingest(judgeSessionSources('a', 'QRD-1639', [finding()] as never));
    assert.strictEqual(w.lessons[0].textId, null, 'no translation leaves it null');
    await w.service.ingest(judgeSessionSources('b', 'QRD-1592', [finding({ text: 'second', lessonId: 'Coba semua key ElevenLabs dulu sebelum pakai edge.' })] as never));
    assert.strictEqual(w.lessons.length, 1);
    assert.strictEqual(w.lessons[0].textId, 'Coba semua key ElevenLabs dulu sebelum pakai edge.', 'a merge fills a missing translation');
    assert.strictEqual(w.sources[1].lessonTextId, 'Coba semua key ElevenLabs dulu sebelum pakai edge.');
    await w.service.ingest(judgeSessionSources('c', 'QRD-1600', [finding({ text: 'third', lessonId: 'Terjemahan lain.' })] as never));
    assert.strictEqual(w.lessons[0].textId, 'Coba semua key ElevenLabs dulu sebelum pakai edge.', 'a merge keeps the translation it has');
    await w.service.ingest(ledgerSources({ key: 'QRD-1646', kind: 'build', stage: 'done', finished: true, prBe: null, prFe: null, failures: [], findings: [], issues: [{ n: 2, type: 'QUESTION', text: 'Keep the old export?', level: 'owner' }], decisions: [], rounds: null, closing: null }));
    assert.strictEqual(w.lessons.find((row) => row.targetKind === 'flow')!.textId, null, 'a ledger source has no translation');
    const view = (await w.service.overview()).lessons.find((row) => row.targetKind === 'skill')!;
    assert.strictEqual(view.textId, 'Coba semua key ElevenLabs dulu sebelum pakai edge.');
    const file = await w.service.prepareTicket('QRD-1639');
    assert.ok(!w.files.get(file!)!.includes('Coba semua key'), 'the per-ticket file stays English');
    assert.strictEqual((await w.service.edit(view.id, view.text, ' Ganti terjemahan. ')).textId, 'Ganti terjemahan.');
    assert.strictEqual((await w.service.edit(view.id, 'Edited text.')).textId, 'Ganti terjemahan.', 'an edit without textId keeps it');
    assert.strictEqual((await w.service.edit(view.id, 'Edited text.', '')).textId, null, 'an empty translation clears it');
  } finally { w.done(); }
});

test('GraphQL returns a lesson textId and editLesson takes an optional textId', async () => {
  const w = world();
  try {
    await w.service.ingest(judgeSessionSources('a', 'QRD-1639', [finding({ lessonId: 'Coba semua key dulu.' }), finding({ cause: 'wrong-code', text: 'other', lesson: 'Run tsc on scripts.' })] as never));
    const schema = buildASTSchema(typeDefs);
    const overview = await w.service.overview();
    const read = await graphql({ schema, source: '{ lessons { lessons { text textId } } }', rootValue: { lessons: overview } });
    assert.strictEqual(read.errors, undefined);
    assert.deepStrictEqual((read.data as { lessons: { lessons: Array<{ text: string; textId: string | null }> } }).lessons.lessons.map((row) => row.textId).sort(), ['Coba semua key dulu.', null].sort());
    const id = overview.lessons.find((row) => row.textId)!.id;
    const edit = await graphql({ schema, source: 'mutation($id: ID!) { editLesson(id: $id, text: "New text.", textId: "Teks baru.") { textId } }', variableValues: { id }, rootValue: { editLesson: (args: { id: string; text: string; textId?: string | null }) => w.service.edit(args.id, args.text, args.textId) } });
    assert.strictEqual(edit.errors, undefined);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(edit.data)), { editLesson: { textId: 'Teks baru.' } });
  } finally { w.done(); }
});

test('GraphQL: the lessons query and the lesson mutations exist and sit behind the PIN', () => {
  assert.strictEqual(typeof (resolvers.Query as Record<string, unknown>).lessons, 'function');
  for (const name of ['editLesson', 'retargetLesson', 'deleteLesson', 'approveLessonCode', 'importLessons']) {
    assert.strictEqual(typeof (resolvers.Mutation as Record<string, unknown>)[name], 'function', name);
    assert.ok((protectedMutations as readonly string[]).includes(name), name);
  }
  assert.ok((protectedQueries as readonly string[]).includes('lessons'));
});
