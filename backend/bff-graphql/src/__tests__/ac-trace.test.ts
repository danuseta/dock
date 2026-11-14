import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { acKeys, buildAcTrace, loadAcTrace, parseAcFile, refsOf, type AcTraceFile, type AcTraceLedger } from '../integrations/ac-trace';
import { Blackboard, boardKind } from '../integrations/blackboard';
import { createBlackboardRouter } from '../routes/blackboard';

const file = (filePath: string, text: string, updatedAt = '2026-11-12T08:00:00Z'): AcTraceFile => ({ path: filePath, text, updatedAt });

const FE_LINES = [
  'The Versions tab opens from the skill header', 'Each version shows its number, chips and note', 'Edit note saves the note in place',
  'The LIVE chip marks the live version', 'The list loads more on scroll', 'Restore loads the version into the editor',
  'Unsaved edits ask before Restore', 'Save as new branch makes the next minor', 'Restore never writes a version by itself',
  'A refused save shows who saved and when', 'The banner offers Save as new branch or Reload', 'Publish check lists the agents that move',
  'The toast names the version and the agents that moved', 'Make live sits in the row menu', 'Make live asks to confirm', 'The LIVE chip moves after Make live',
];
const BE_LINES = [
  'Restore writes nothing', 'INITIAL reads as REFERENCE', 'A new branch is written in order', 'Two saves from one base never overwrite each other',
  'Every version records who and when', 'Every version records its base and note', 'Publish preview lists agents that move',
  'Publish preview lists agents that stay', 'Make live does not compile again', 'Make live is refused without access',
];

/** A board shaped like QRD-1292 (BE #1342, FE #1115): ac.md per side, six tasks, a final verdict with FE 13 left open. */
function qrd1292(): { files: AcTraceFile[]; ledger: AcTraceLedger } {
  const ac = ['# QRD-1292 acceptance criteria', '## FE', ...FE_LINES.map((line, index) => `${index + 1}. ${line}`), '', '## BE', ...BE_LINES.map((line, index) => `${index + 1}. ${line}`)].join('\n');
  const tasks = [
    '# QRD-1292 tasks', '## T1 BE saved versions', '- Covers AC: BE 1-3, BE 5-6', '## T2 BE publish preview and 409', '- Covers AC: BE 4, BE 7-10',
    '## T3 FE Versions tab', '- Covers AC: FE 1-5', '## T4 FE restore', '- Covers AC: FE 6-9', '## T5 FE banner', '- Covers AC: FE 10-11', '## T6 FE publish and make live', '- Covers AC: FE 12-16',
  ].join('\n');
  const feRefs: Record<number, string> = {
    1: 'versions-tab.tsx:42', 2: 'version-row.tsx:18', 3: 'version-row.tsx:61', 4: 'version-row.tsx:30', 5: 'versions-tab.tsx:88', 6: 'restore-dialog.tsx:27',
    7: 'restore-dialog.tsx:40', 8: 'use-restore-version.ts:55', 9: 'use-restore-version.ts:70', 10: 'refused-save-banner.tsx:14', 11: 'refused-save-banner.tsx:30',
    12: 'publish-check-dialog.tsx:88', 14: 'make-live-dialog.tsx:31', 15: 'make-live-dialog.tsx:44', 16: 'version-row.tsx:33',
  };
  const rows = [
    ...FE_LINES.map((_, index) => {
      const n = index + 1;
      return feRefs[n] ? `| FE ${n} | PASS | ${feRefs[n]} | ${n === 6 ? 'restore-dialog.test.tsx:18' : '-'} |` : `| FE ${n} | missing | toast joins every name, no "and 3 more" | - |`;
    }),
    ...BE_LINES.map((_, index) => `| BE ${index + 1} | PASS | skill-version.service.ts:${120 + index * 10} | skill-version.service.test.ts:${40 + index} |`),
  ];
  const final = ['# review FINAL QRD-1292 - VERDICT: FIX', '', '| AC | result | path:line | test |', '|---|---|---|---|', ...rows].join('\n');
  const status = ['2026-11-12 09:40 · QRD-1292 · HANDOFF · T1 done: versions', '2026-11-12 10:30 · QRD-1292 · HANDOFF · T3 done: tab'].join('\n');
  return {
    files: [file('ac.md', ac), file('tasks.md', tasks), file('review-FINAL.md', final), file('status.md', status), file('review.md', '# old review\n| AC | path:line |\n|---|---|\n| FE 1 | old.tsx:1 |', '2026-11-01T00:00:00Z')],
    ledger: { ac: [], prBe: 'https://github.com/qonekid/ms-admin-worker-backend/pull/1342', prFe: 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/1115' },
  };
}

test('QRD-1292: AC lines grouped FE / BE as sous wrote them, 25 of 26 with path:line, the task and pull request per line', () => {
  const { files, ledger } = qrd1292();
  const trace = buildAcTrace('QRD-1292', files, ledger);
  assert.strictEqual(trace.readable, true);
  assert.deepStrictEqual([trace.covered, trace.total], [25, 26]);
  assert.deepStrictEqual(trace.formats, ['ac-md', 'review-table', 'tasks-sections']);
  assert.deepStrictEqual(trace.sources, ['ac.md', 'review-FINAL.md', 'tasks.md'], 'the final verdict wins over the older review');
  assert.deepStrictEqual([...new Set(trace.lines.map((line) => line.group))], ['FE', 'BE']);
  const fe13 = trace.lines.find((line) => line.label === 'FE 13');
  assert.deepStrictEqual([fe13?.refs, fe13?.state, fe13?.tasks.map((task) => task.id), fe13?.prs], [[], 'FAIL', ['T6'], []]);
  const fe6 = trace.lines.find((line) => line.label === 'FE 6');
  assert.deepStrictEqual([fe6?.text, fe6?.refs.map((ref) => `${ref.path}:${ref.line}`), fe6?.tests, fe6?.prs], ['Restore loads the version into the editor', ['restore-dialog.tsx:27'], ['restore-dialog.test.tsx:18'], ['FE #1115']]);
  const be1 = trace.lines.find((line) => line.label === 'BE 1');
  assert.deepStrictEqual([be1?.tasks, be1?.prs], [[{ id: 'T1', title: 'BE saved versions', done: true }], ['BE #1342']]);
  assert.deepStrictEqual(trace.pulls.map((pull) => pull.label), ['BE #1342', 'FE #1115']);
});

test('the QRD-1346 shape: ac.txt, task sections with "Covers AC", a final table whose cells use the legend aliases', () => {
  const final = [
    'BE = /home/coder/projects/wt-1346-be. svc = src/services/datapoint-recycle.service.ts, U = tests/unit/services/datapoint-recycle.service.test.ts, D = FE src/v2/recycle-rules-dialog.tsx.',
    '| AC | result | what | path:line | test |', '|---|---|---|---|---|',
    '| 1 | PASS | many rules | svc:239-263, D:490-555 | U:72 |',
    '| 2 | PASS (D-18) | own claim | svc:465-496, :498 | U:391, U:408 |',
  ].join('\n');
  const trace = buildAcTrace('QRD-1346', [
    file('ac.txt', 'A client can define more than one recycling rule\nEach rule runs independently of the others\nA rule selects rows by time frame'),
    file('tasks.md', '## T1 BE core\n- Covers AC: 1,2 (service side),3\n## T3 FE\n- Covers AC: 1,3'),
    file('review-FINAL.md', final),
  ], null);
  assert.deepStrictEqual([trace.covered, trace.total], [2, 3]);
  assert.deepStrictEqual(trace.lines[0].refs.map((ref) => [ref.path, ref.line, ref.end, ref.side]), [['src/services/datapoint-recycle.service.ts', 239, 263, null], ['src/v2/recycle-rules-dialog.tsx', 490, 555, 'fe']]);
  assert.deepStrictEqual(trace.lines[1].refs.map((ref) => ref.line), [465, 498], 'a bare :line takes the path before it');
  assert.deepStrictEqual(trace.lines[0].tests, ['U:72']);
  assert.deepStrictEqual(trace.lines[0].tasks.map((task) => task.id), ['T1', 'T3']);
  assert.deepStrictEqual(trace.lines[2].refs, [], 'a line the verdict never named is marked, not guessed');
});

test('every table layout the verdicts use: "# | AC line", AC text rows, FE / BE columns, a test column', () => {
  const numbered = buildAcTrace('QRD-1427', [file('review.md', '## AC to code\n| # | AC line | path:line |\n|---|---|---|\n| 1 | popup opens | FE src/v2/pages/robo/playbook.tsx:935-939 |\n| 2 | no stats strip | playbook.tsx diff adds only the popover |')], null);
  assert.deepStrictEqual(numbered.lines.map((line) => [line.label, line.text, line.refs.map((ref) => `${ref.side}:${ref.path}:${ref.line}`)]), [['1', 'popup opens', ['fe:src/v2/pages/robo/playbook.tsx:935']], ['2', 'no stats strip', ['null:playbook.tsx:null']]]);
  assert.deepStrictEqual([numbered.covered, numbered.total], [1, 2], 'a file name with no line is not a path:line');
  const sides = buildAcTrace('QRD-1484', [file('review.md', '| AC | FE | BE | State |\n|---|---|---|---|\n| Share dialog offers Get share code | share/skill-share-dialog.tsx:107-115 | - | met |\n| Code shown | share-code-dialog.tsx:72 | playbook-share-code.service.ts:40 | met |')], null);
  assert.deepStrictEqual(sides.lines[1].refs.map((ref) => ref.side), ['fe', 'be']);
  assert.deepStrictEqual(sides.lines.map((line) => line.state), ['PASS', 'PASS']);
  const textRows = buildAcTrace('QRD-1345', [
    file('tasks.md', '| Task | Issue | Files owned | AC row |\n|---|---|---|---|\n| T1 | F4 cache | x.ts | 1 |\n| T2 | F2a insert | y.ts | 2 |'),
    file('review-FINAL.md', '| AC | path:line | test | ok/missing |\n|---|---|---|---|\n| F4 per-datapoint cache | src/services/size.service.ts:136-140 | service.test cache | ok |\n| F2a optional arg | src/helpers/size.helper.ts:9-16; src/models/log.model.ts:115-118,137 | helper.test | missing |'),
  ], null);
  assert.deepStrictEqual(textRows.lines.map((line) => [line.label, line.state, line.tasks.map((task) => task.id).join(), line.refs.length]), [['F 4', 'PASS', 'T1', 1], ['F 2', 'FAIL', 'T2', 3]]);
});

test('AC map sections: numbered parts on one line, and FE / BE bullet lists', () => {
  const inline = buildAcTrace('QRD-1508', [file('review.md', '## AC map\n1 MISSING (no Pick a tool) · 2 builtin-tool.helper.ts:19 · 3 structural\n4 arm-from-playbook-dialog.tsx:351\n\n## Next')], null);
  assert.deepStrictEqual(inline.lines.map((line) => [line.label, line.state, line.refs.length]), [['1', 'FAIL', 0], ['2', null, 1], ['3', null, 0], ['4', null, 1]]);
  assert.deepStrictEqual(inline.formats, ['ac-map']);
  const bullets = buildAcTrace('QRD-1289', [file('review.md', '## AC map\nFE\n- Rename from row menu: playbook-row-menu.tsx:41 - met\n- Same name in other folder allowed: siblings scoped to parentId - met\nBE\n- Rename endpoint: playbook.route.ts:51 - met')], null);
  assert.deepStrictEqual(bullets.lines.map((line) => [line.label, line.group, line.text, line.refs.map((ref) => ref.side)]), [['FE 1', 'FE', 'Rename from row menu', ['fe']], ['FE 2', 'FE', 'Same name in other folder allowed', []], ['BE 1', 'BE', 'Rename endpoint', ['be']]]);
});

test('an "## AC checklist" list and the NOW.md table status.cjs renders from the ledger', () => {
  const list = buildAcTrace('QRD-1298', [file('review-full.md', '## AC checklist (1 of 2 with path:line)\nFE (wt-1298)\n1. New menu, icons: playbook/components/playbook-new-menu.tsx:86-96\n2. Agent card: not built (QRD-1306)\n## Findings\n1. nit: x.tsx:3')], null);
  assert.deepStrictEqual(list.lines.map((line) => [line.label, line.refs.length, line.state]), [['1', 1, null], ['2', 0, 'FAIL']]);
  const now = buildAcTrace('QRD-1483', [file('NOW.md', '## Acceptance criteria\n\n| AC | State | Text |\n|---|---|---|\n| 1 | PASS | REFERENCE replaces INITIAL |\n| 2 | TODO | Old pointers read as REFERENCE |\n\n## Open issues')], null);
  assert.deepStrictEqual(now.lines.map((line) => [line.n, line.state, line.text]), [[1, 'PASS', 'REFERENCE replaces INITIAL'], [2, 'TODO', 'Old pointers read as REFERENCE']]);
  assert.deepStrictEqual([now.covered, now.formats], [0, ['now-table']]);
});

test('the ledger gives the lines and its evidence fills a line no verdict named', () => {
  const trace = buildAcTrace('QRD-1500', [], {
    ac: [{ n: 1, state: 'PASS', text: 'Folder name', evidence: 'folder-dialog.tsx:12' }, { n: 2, state: 'FAIL', text: 'Tags filter', evidence: 'screenshot only' }],
    prBe: null, prFe: 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/9',
  });
  assert.deepStrictEqual(trace.lines.map((line) => [line.text, line.state, line.refs.length, line.note, line.prs]), [['Folder name', 'PASS', 1, null, ['FE #9']], ['Tags filter', 'FAIL', 0, 'screenshot only', []]]);
  assert.ok(trace.formats.includes('ledger-evidence'));
});

test('older, looser boards: prose without an AC table reads as "belum ada", never an error', () => {
  const loose = buildAcTrace('QRD-1267', [file('review.md', '# Review\n## Result: approve\n- blocker · FE guardrail-factory.ts:30 starts with two levels.'), file('NOW.md', '## Acceptance criteria\n\n| AC | State | Text |\n|---|---|---|\n\n## Open issues')], null);
  assert.deepStrictEqual([loose.readable, loose.total, loose.covered, loose.lines], [false, 0, 0, []]);
  assert.deepStrictEqual(buildAcTrace('QRD-1', [file('review.md', '| AC | path:line |\n|---|---|\n')], null).readable, false);
});

test('path:line tokens: aliases, ranges, extra lines, bare names are not paths', () => {
  const aliases = new Map([['svc', { path: 'src/svc.ts', side: null }]]);
  assert.deepStrictEqual(refsOf('svc:832, storage-size.service.ts:134-156, 11:42 and D-18', aliases).map((ref) => [ref.path, ref.line, ref.end]), [['src/svc.ts', 832, null], ['storage-size.service.ts', 134, 156]]);
  assert.deepStrictEqual(refsOf('BE `rule.model:46`, ccfg:121').map((ref) => [ref.path, ref.side]), [['rule.model', 'be']]);
  assert.deepStrictEqual(acKeys('1,2,9 (service side: x),10-12, FE 1–3, 6/7'), ['1', '2', '9', '10', '11', '12', 'FE 1', 'FE 2', 'FE 3', '6', '7']);
  assert.deepStrictEqual(parseAcFile('- FE3 CALL chip by id\n- BE 2 refuses', 'ac.md').map((line) => [line.label, line.group]), [['FE 3', 'FE'], ['BE 2', 'BE']]);
});

function board() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ac-trace-'));
  const sprints = mkdtempSync(path.join(os.tmpdir(), 'ac-trace-sprints-'));
  const put = (base: string, relative: string, body: string) => {
    const target = path.join(base, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  };
  for (const entry of qrd1292().files) put(root, `QRD-1292/${entry.path}`, entry.text.replace(/\n/g, '\r\n'));
  put(root, 'QRD-1267/review.md', '# Review\nprose only');
  put(root, 'kamus-pengucapan.md', '# Kamus pengucapan\n- QRD: kyu-ar-di');
  put(sprints, 'Sprint-27/QRD-1233/QRD-1292-materials.md', '# materials');
  return { root, sprints, done: () => { rmSync(root, { recursive: true, force: true }); rmSync(sprints, { recursive: true, force: true }); } };
}

test('loadAcTrace reads the board files (CRLF too); a ticket without a board has no trace', async () => {
  const { root, sprints, done } = board();
  try {
    const blackboard = new Blackboard(root, sprints);
    const trace = await loadAcTrace(blackboard, 'QRD-1292', qrd1292().ledger);
    assert.deepStrictEqual([trace?.covered, trace?.total], [25, 26]);
    assert.strictEqual((await loadAcTrace(blackboard, 'QRD-1267', null))?.readable, false);
    assert.strictEqual(await loadAcTrace(blackboard, 'QRD-9999', null), null);
    const tickets = await blackboard.tickets();
    assert.deepStrictEqual(tickets.filter((ticket) => ticket.key !== 'QRD-1267').map((ticket) => [ticket.key, ticket.sprint, ticket.kind]), [['QRD-1292', 'Sprint-27', 'task']]);
    assert.strictEqual(tickets.find((ticket) => ticket.key === 'QRD-1267')?.kind, 'review');
    assert.deepStrictEqual([boardKind([{ path: 'review.md' }]), boardKind([{ path: 'prompts/S1.md' }])], ['review', 'task']);
  } finally { done(); }
});

test('router: /:key/ac-trace with the stored ledger, /root/kamus-pengucapan.md, and nothing else at the root', async () => {
  const { root, sprints, done } = board();
  const app = express();
  app.use('/api/blackboard', createBlackboardRouter({ board: new Blackboard(root, sprints), authorize: async () => true, ledger: async (key) => (key === 'QRD-1292' ? qrd1292().ledger : null) }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/blackboard`;
  try {
    const traced = await fetch(`${base}/QRD-1292/ac-trace`);
    const body = await traced.json() as { trace: { covered: number; total: number; pulls: Array<{ label: string }> } };
    assert.deepStrictEqual([traced.status, body.trace.covered, body.trace.total, body.trace.pulls.map((pull) => pull.label)], [200, 25, 26, ['BE #1342', 'FE #1115']]);
    assert.strictEqual((await fetch(`${base}/QRD-9999/ac-trace`)).status, 404);
    const kamus = await fetch(`${base}/root/kamus-pengucapan.md`);
    assert.deepStrictEqual([kamus.status, kamus.headers.get('content-type'), await kamus.text()], [200, 'text/markdown; charset=utf-8', '# Kamus pengucapan\n- QRD: kyu-ar-di']);
    assert.strictEqual((await fetch(`${base}/root/secret.md`)).status, 404);
    assert.strictEqual((await fetch(`${base}/root/..%2Foutside.md`)).status, 404);
  } finally {
    server.close();
    done();
  }
});
