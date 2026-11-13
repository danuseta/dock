import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NOTHING_YET, coverageText, hasCode, missingOnly, refMatches, refreshAcTrace, traceGroups, withIndonesian, type AcTrace, type AcTraceLine } from '../lib/acTrace';
import { CONTRACT_ENTRY, LOG_ENTRY, NO_SPRINT, TRACE_ENTRY, boardTree, blackboardFileHref, contractFiles, isPullEntry, pullEntry, pullRepo, sprintGroups, type BlackboardFile, type BlackboardTicket } from '../lib/blackboard';
import { duration, execRows, filterExec } from '../lib/execLog';
import { slimDetail } from '../lib/ticketDetail';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');
const file = (path: string, kind: BlackboardFile['kind'] = 'text', updatedAt = '2026-11-12T08:00:00Z'): BlackboardFile => ({ path, size: 10, updatedAt, kind, generated: false });

const line = (n: number, label: string, group: string | null, refs: Array<[string, number | null]>): AcTraceLine => ({
  n, label, group, text: `AC ${label}`, state: refs.length ? 'PASS' : 'FAIL', tasks: [{ id: 'T1', title: 'BE saved versions', done: true }],
  refs: refs.map(([path, at]) => ({ path, line: at, end: null, text: at === null ? path : `${path}:${at}`, side: group === 'BE' ? 'be' : group === 'FE' ? 'fe' : null })),
  tests: [], prs: refs.length ? [group === 'BE' ? 'BE #1342' : 'FE #1115'] : [], note: null,
});

/** QRD-1292 as the API reads it: FE 1–16 and BE 1–10, FE 13 without path:line. */
const QRD_1292: AcTrace = {
  key: 'QRD-1292', readable: true, total: 26, covered: 25,
  lines: [
    ...Array.from({ length: 16 }, (_, index) => line(index + 1, `FE ${index + 1}`, 'FE', index === 12 ? [] : [[`versions-${index}.tsx`, 10 + index]])),
    ...Array.from({ length: 10 }, (_, index) => line(17 + index, `BE ${index + 1}`, 'BE', [['skill-version.service.ts', 120 + index]])),
  ],
  pulls: [{ side: 'be', url: 'https://github.com/qonekid/ms-admin-worker-backend/pull/1342', label: 'BE #1342' }, { side: 'fe', url: 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/1115', label: 'FE #1115' }],
  sources: ['ac.md', 'review-FINAL.md', 'tasks.md'], formats: ['ac-md', 'review-table', 'tasks-sections'],
};

test('QRD-1292: n/total, grouped FE / BE, and the filter keeps only the line without path:line', () => {
  assert.strictEqual(coverageText(QRD_1292), '25/26');
  assert.deepStrictEqual(traceGroups(QRD_1292.lines).map((group) => [group.group, group.lines.length]), [['FE', 16], ['BE', 10]]);
  assert.deepStrictEqual(missingOnly(QRD_1292.lines).map((item) => item.label), ['FE 13']);
  assert.strictEqual(hasCode(line(1, '1', null, [['a.tsx', null]])), false, 'a file name without a line is not a path:line');
});

test('an unreadable or missing trace reads "belum ada", never a number', () => {
  assert.strictEqual(coverageText(null), NOTHING_YET);
  assert.strictEqual(coverageText({ ...QRD_1292, readable: false, total: 0, covered: 0, lines: [] }), 'belum ada');
  assert.doesNotThrow(() => refreshAcTrace('QRD-1292'), 'a refresh with nobody listening is a no-op');
});

test('the Indonesian line shows only when the summary was written for the same AC, one line per AC line', () => {
  const ids = QRD_1292.lines.map((item) => `Baris ${item.label}`);
  assert.strictEqual(withIndonesian(QRD_1292, { acId: ids, current: true }).lines[12].textId, 'Baris FE 13');
  assert.strictEqual(withIndonesian(QRD_1292, { acId: ids, current: false }).lines[0].textId, null, 'a summary of older AC is hidden');
  assert.strictEqual(withIndonesian(QRD_1292, { acId: ids.slice(1), current: true }).lines[0].textId, null, 'a count that differs is hidden');
  assert.strictEqual(withIndonesian(QRD_1292, null).lines[0].textId, null);
  assert.ok(refMatches({ path: 'versions-tab.tsx', line: 4, end: null, text: '', side: 'fe' }, 'src/v2/versions-tab.tsx'));
  assert.ok(!refMatches({ path: 'tab.tsx', line: 4, end: null, text: '', side: 'fe' }, 'src/v2/versions-tab.tsx'));
});

test('3a: tickets per sprint, newest first, with the Task / Review filter; a ticket with no sprint goes last', () => {
  const ticket = (key: string, sprint: string | null, kind: 'task' | 'review'): BlackboardTicket => ({ key, epic: null, updatedAt: '2026-11-12T08:00:00Z', files: 3, sprint, kind });
  const tickets = [ticket('QRD-1292', 'Sprint-27', 'task'), ticket('QRD-1508', 'Sprint-26', 'review'), ticket('QRD-1189', null, 'review'), ticket('QRD-1510', 'Sprint-27', 'task')];
  assert.deepStrictEqual(sprintGroups(tickets, 'all').map((group) => [group.sprint, group.tickets.map((item) => item.key)]), [['Sprint-27', ['QRD-1292', 'QRD-1510']], ['Sprint-26', ['QRD-1508']], [NO_SPRINT, ['QRD-1189']]]);
  assert.deepStrictEqual(sprintGroups(tickets, 'review').map((group) => group.sprint), ['Sprint-26', NO_SPRINT]);
  assert.deepStrictEqual(sprintGroups(tickets, 'task', () => 'Sprint 27').map((group) => group.tickets.length), [2], 'the Jira sprint name fills a board without one');
});

test('3a: one ticket\'s folders: Dokumen, Artifacts, the rest; the contract is the newest contract file', () => {
  const tree = boardTree([file('NOW.md'), file('review.md'), file('screenshots/a.png', 'image'), file('materials/contract-484933635-v1.md', 'text', '2026-11-10T00:00:00Z'), file('materials/contract.md', 'text', '2026-11-11T00:00:00Z'), file('prompts/S1.md')]);
  assert.deepStrictEqual(tree.docs.map((item) => item.path), ['NOW.md', 'review.md']);
  assert.deepStrictEqual(tree.artifacts.map((group) => group.folder), ['materials', 'screenshots']);
  assert.deepStrictEqual(tree.other.map((group) => group.folder), ['prompts']);
  assert.deepStrictEqual(contractFiles([file('materials/contract-484933635-v1.md', 'text', '2026-11-10T00:00:00Z'), file('materials/contract.md', 'text', '2026-11-11T00:00:00Z'), file('NOW.md')]).map((item) => item.path), ['materials/contract.md', 'materials/contract-484933635-v1.md']);
  assert.deepStrictEqual([pullEntry('ms-admin-worker-backend'), pullRepo('pr:ms-admin-worker-backend'), pullRepo('pr:'), isPullEntry('pr:'), isPullEntry('NOW.md')], ['pr:ms-admin-worker-backend', 'ms-admin-worker-backend', null, true, false]);
  assert.strictEqual(blackboardFileHref('QRD-1292', TRACE_ENTRY), '/blackboard?key=QRD-1292&file=%40trace');
});

test('AC 1 + 3a: the Files column has Tiket → kode with n/total directly above Log; opening a ticket swaps the list for its folders with a way back; kamus at the root', () => {
  const page = read('pages/BlackboardPage.tsx');
  const traceAt = page.indexOf("entry(TRACE_ENTRY, Route, 'Tiket → kode', coverageText(trace))");
  const logAt = page.indexOf('onClick={() => setSelected(LOG_ENTRY)}');
  assert.ok(traceAt > 0 && logAt > traceAt, 'Tiket → kode sits above Log');
  assert.ok(page.slice(traceAt, logAt).split('\n').length <= 3, 'nothing between them');
  assert.match(page, /\{!picked \? \(\s*<section[^>]*aria-label="Tickets"/);
  assert.match(page, />Semua tiket</);
  assert.match(page, /fetchRootText\(KAMUS_FILE\)/);
  assert.match(page, /\(\[\['all', 'Semua'\], \['task', 'Task'\], \['review', 'Review'\]\] as const\)/);
  assert.match(page, /<AcMap trace=\{trace\}/);
  assert.match(page, /<ContractView ticket=\{picked\}/);
  assert.match(page, /<ExecLog ticket=\{picked\} run=\{run\} timeline=\{run\?\.timeline \?\? null\} \/><LogView ticket=\{picked\} \/>/);
  assert.equal([LOG_ENTRY, TRACE_ENTRY, CONTRACT_ENTRY].every((entry) => entry.startsWith('@')), true, 'generated entries never clash with a file path');
});

test('AC 2–4: the map shows the task with its status, the PR and path:line per line, marks a line without one, and opens a line with its text, Indonesian line, tests and PR', () => {
  const map = read('pages/blackboard/AcMap.tsx');
  assert.match(map, /<span>Baris AC<\/span><span>Task<\/span><span>Kode \(PR · path:line\)<\/span>/);
  assert.match(map, /task\.done \? <CheckCircle2/);
  assert.match(map, /belum ada path:line/);
  assert.match(map, /Cuma yang belum ada path:line/);
  assert.match(map, /\{line\.textId && <p/);
  assert.match(map, /Tes yang nutup/);
  assert.match(map, />Pull request</);
});

test('3d: log rows from spawn and stop, with failures and events, oldest first', () => {
  const rows = execRows(
    { failures: [{ at: '2026-11-12T09:20:00Z', type: 'defect', what: 'controller test does not load', evidence: 'x', attempt: 1 }], events: [{ id: '1', kind: 'STAGE', detail: 'code', at: '2026-11-12T09:05:00Z' }] },
    { visits: [{ stageIndex: 1, round: 1, agents: [
      { id: 'main', parentId: null, name: 'lead', detail: null, state: 'active', tool: null, tools: 9 },
      { id: 'a1', parentId: 'main', name: 'sous-planner', detail: 'Pecah AC jadi task', state: 'done', tool: null, tools: 44, since: '2026-11-12T09:00:00Z', until: '2026-11-12T09:04:00Z' },
    ] }, { stageIndex: 2, round: 1, agents: [{ id: 'a1', parentId: 'main', name: 'sous-planner', detail: null, state: 'done', tool: null, tools: 44, since: '2026-11-12T09:00:00Z' }] }] },
  );
  assert.deepStrictEqual(rows.map((row) => [row.kind, row.agent, row.result]), [['agent', 'sous-planner', 'OK'], ['event', 'event', ''], ['fail', 'defect', 'GAGAL #1']]);
  assert.deepStrictEqual([rows[0].seconds, duration(rows[0].seconds), filterExec(rows, 'fail').length], [240, '4m', 1]);
  assert.deepStrictEqual(execRows(null, null), []);
});

test('3d: Kontrak shows the goal, the definition of done from Tiket → kode, the limits and a read-only Party', () => {
  const contract = read('pages/blackboard/ContractView.tsx');
  for (const heading of ['Tujuan', 'Tiket dan branch', 'Definition of done', 'Batasan', 'Halaman kontrak']) assert.match(contract, new RegExp(`>${heading}<`));
  assert.match(contract, /Party <span/);
  assert.doesNotMatch(contract, /useMutation|method: 'POST'/, 'Party is display only');
});

test('3e + AC 5: the workspace ticket detail is slim with one Blackboard card; the laptop keeps the old sections', () => {
  assert.strictEqual(slimDetail('workspace'), true);
  assert.strictEqual(slimDetail('laptop'), false, 'the laptop has no Blackboard, so nothing moves off the detail');
  const detail = read('pages/TicketDetailPage.tsx');
  assert.match(detail, /const slim = slimDetail\(dockMode\);/);
  assert.match(detail, /const acRun = slim \? null : run;/);
  assert.match(detail, /\{!slim && \(\s*<p className="mt-0\.5 flex items-center gap-1 truncate font-mono/);
  assert.match(detail, /\{!slim && \(ticket\.pullRequests\?\.length \?\? 0\) > 1 && \(/);
  assert.match(detail, /line\(Route, 'Tiket → kode', <span[^>]*>\{coverageText\(trace\)\}<\/span>, blackboardFileHref\(ticket\.key, TRACE_ENTRY\)\)/);
  assert.match(detail, /buka<ArrowRight/);
  assert.match(detail, /<h2 className=\{sectionTitle\}>Demo<\/h2>/, 'Demo URL stays editable on the detail');
  assert.match(detail, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void handleSaveDemo\(\); \}\}/);
  for (const kept of ['ReadinessCard', 'SummaryBlock', 'title="User Story"', 'title="Problem Definition"', 'Pull requests']) assert.ok(detail.includes(kept), kept);
});

test('3f: the Agents run panel keeps the header, Waiting on you, Activity & info and one AC line on the workspace; folds and Session flow stay for the laptop', () => {
  const agents = read('pages/AgentsPage.tsx');
  assert.match(agents, /const slim = slimDetail\(mode\);/);
  assert.match(agents, /Tiket → kode <span[^>]*>\{coverageText\(trace\)\}<\/span>/);
  assert.match(agents, />Buka Blackboard<\/Button>/);
  assert.match(agents, />Buka Session<\/Button>/);
  assert.match(agents, /\{!slim && \(\s*<>\s*<RunDecisions/);
  assert.match(agents, /\{!slim && \(\s*<Card className="mt-4 p-0 max-\[760px\]:order-7">/);
  const slimAt = agents.indexOf('{slim && (');
  for (const kept of ['Waiting on you', 'Activity &amp; info', 'aria-label="Stages"']) assert.ok(agents.indexOf(kept) > 0 && agents.indexOf(kept) < slimAt, kept);
});

test('AC 6: the Sessions right panel shows the short Tiket → kode line, read again on the poll and on refreshAcTrace', () => {
  const inspector = read('chat/SessionInspector.tsx');
  assert.match(inspector, /const trace = useAcTrace\(ticketKey, onBlackboard\);/);
  assert.match(inspector, /Tiket → kode <span[^>]*>\{coverageText\(trace\)\}<\/span>/);
  const hook = read('lib/acTrace.ts');
  assert.match(hook, /export function refreshAcTrace\(key: string\)/);
  assert.match(hook, /window\.setInterval\(load, pollMs\)/);
});

test('Reference and Developer Context show under Description in both modes, read only, hidden when empty, folded like Description', () => {
  const detail = read('pages/TicketDetailPage.tsx');
  const description = detail.indexOf('<JiraField title="Description"');
  const reference = detail.indexOf('{ticket.reference?.trim() && <JiraField title="Reference" field="customfield_10333" text={ticket.reference} />}');
  const context = detail.indexOf('{ticket.developerContext?.trim() && <JiraField title="Developer Context" field="customfield_10340" text={ticket.developerContext} />}');
  assert.ok(description > 0 && reference > description && context > reference, 'Description, then Reference, then Developer Context');
  assert.doesNotMatch(detail.slice(reference - 40, context), /slim/, 'not gated on the workspace: the laptop shows them too');
  assert.match(detail, /const fold = isLongDescription\(text, 3\);/);
  assert.match(detail, /Jira field · \{field\}/);
});
