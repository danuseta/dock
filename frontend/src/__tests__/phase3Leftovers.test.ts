import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AcRef, AcTracePull } from '../lib/acTrace';
import { patchFor, refDisplay, snippetAround } from '../lib/acSnippet';
import { draftStoryboard } from '../lib/contractLinks';
import { intinyaTitle } from '../lib/ticketDetail';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');
const ref = (path: string, line: number | null, text: string, side: AcRef['side'] = null, end: number | null = null): AcRef => ({ path, line, end, text, side });
const PULLS: AcTracePull[] = [
  { side: 'be', url: 'https://github.com/qonekid/ms-admin-worker-backend/pull/1342', label: 'BE #1342' },
  { side: 'fe', url: 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/1115', label: 'FE #1115' },
];

test('1: a verdict alias reads as its full path with the repository in front, the alias as written stays the tooltip', () => {
  assert.deepStrictEqual(refDisplay(ref('src/services/datapoint-recycle.service.ts', 239, 'svc:239-263', 'be', 263), PULLS), { label: 'ms-admin-worker-backend/src/services/datapoint-recycle.service.ts:239-263', title: 'svc:239-263' });
  assert.deepStrictEqual(refDisplay(ref('src/services/x.ts', 12, 'src/services/x.ts:12'), PULLS), { label: 'src/services/x.ts:12', title: null }, 'no side: no repository, nothing to explain');
  assert.deepStrictEqual(refDisplay(ref('run.model', 27, 'run.model:27', null, 28), PULLS), { label: 'run.model:27-28', title: 'run.model:27' }, 'an alias the legend never defined stays as written');
});

const PATCH = ['@@ -10,8 +10,10 @@ export class SkillVersionService {', ...Array.from({ length: 6 }, (_, index) => ` line ${10 + index}`), '-  old();', '+  restore();', '+  save();', ' tail', ' end'].join('\n');

test('2: the snippet is the hunk slice around the line, 5 lines each side, with +/- kinds; outside a hunk it has none', () => {
  const rows = snippetAround(PATCH, 16);
  assert.ok(rows);
  assert.deepStrictEqual(rows.map((row) => [row.kind, row.newLine, row.hit]).filter((row) => row[2]), [['add', 16, true]]);
  assert.strictEqual(rows[0].newLine, 12, 'five lines before');
  assert.deepStrictEqual([rows.length, rows.some((row) => row.kind === 'del')], [9, true], 'the hunk ends three lines after');
  assert.strictEqual(snippetAround(PATCH, 400), null);
  assert.strictEqual(snippetAround(null, 17), null);
  assert.strictEqual(snippetAround(PATCH, null), null);
  const files = [{ repo: 'ms-client-dashboard-frontend', path: 'src/services/skill-version.service.ts', patch: 'fe' }, { repo: 'ms-admin-worker-backend', path: 'src/services/skill-version.service.ts', patch: PATCH }];
  assert.strictEqual(patchFor(ref('skill-version.service.ts', 17, 'skill-version.service.ts:17', 'be'), files, PULLS)?.patch, PATCH, 'the side picks the repository');
  assert.strictEqual(patchFor(ref('missing.ts', 1, 'missing.ts:1'), files, PULLS), null);
});

test('2: the AC line detail shows a snippet per path:line from the Perubahan kode data, or "snippet belum ada", and keeps the link', () => {
  const map = read('pages/blackboard/AcMap.tsx');
  assert.match(map, /snippet belum ada/);
  assert.match(map, /\{ref\.line !== null && <RefSnippet value=\{ref\} pulls=\{pulls\} files=\{files\} \/>\}/);
  assert.match(map, /title=\{shown\.title \?\? undefined\}/);
  const page = read('pages/BlackboardPage.tsx');
  assert.match(page, /usePullPatches\(picked, repos, selected === TRACE_ENTRY\)/, 'GitHub is read only while Tiket → kode is open');
  assert.match(read('lib/usePullPatches.ts'), /query: GET_TICKET_CHANGES, variables: \{ ticketKey, tab \}, fetchPolicy: 'cache-first'/);
  assert.doesNotMatch(read('lib/usePullPatches.ts'), /useMutation|mutate\(/);
});

test('3: Kontrak shows the demo, the Figma link and the draft storyboard, each hidden when absent', () => {
  const draft = {
    tickets: [{ key: 'QRD-1292', epic: 'QRD-1233', storyboard: { version: 4, frames: ['F1.2', 'F1.3'] } }, { key: 'QRD-9', epic: null, storyboard: null }],
    storyboards: [{ epic: 'QRD-1233', version: 4, frames: 20, htmlUrl: 'https://claude.ai/artifact/x' }],
  };
  assert.deepStrictEqual(draftStoryboard(draft, 'QRD-1292'), { epic: 'QRD-1233', version: 4, frames: 2, htmlUrl: 'https://claude.ai/artifact/x' });
  assert.strictEqual(draftStoryboard(draft, 'QRD-9'), null);
  assert.strictEqual(draftStoryboard(null, 'QRD-1292'), null);
  const view = read('pages/blackboard/ContractView.tsx');
  assert.match(view, /\{\(demoUrl \|\| figmaUrl \|\| storyboard\) && \(/);
  assert.match(view, /isPlayableVideo\(demoUrl\)\s*\? <video/);
  assert.match(view, /Figma Link \(Jira\)/);
  assert.match(read('pages/BlackboardPage.tsx'), /demoUrl=\{jiraTicket\?\.demoLink\?\.url \?\? null\} figmaUrl=\{jiraTicket\?\.figmaUrl \?\? null\} storyboard=\{storyboard\}/);
});

test('4: board cards show the summary line in blue with the Intinya on hover, from the one readiness query of the board', () => {
  assert.strictEqual(intinyaTitle({ made: 'Tab Versions', checked: 'Restore', notHere: '', waitsOn: ['QRD-1307'] }), 'Bikin apa: Tab Versions\nDicek di sini: Restore\nNunggu tiket lain: QRD-1307');
  const card = read('components/TicketCard.tsx');
  assert.match(card, /\{summary\?\.line\?\.trim\(\) && <span className="[^"]*text-sky-200" title=\{intinyaTitle\(summary\)\}>\{summary\.line\}<\/span>\}/);
  const board = read('pages/DashboardPage.tsx');
  assert.strictEqual(board.match(/useReadiness\(/g)?.length, 1, 'one batched query, no query per card');
  assert.match(board, /summary=\{summaries\.get\(ticket\.key\) \?\? null\}/);
  assert.match(board, /readiness=\{readinessOnBoard\(column\.id, readiness\.get\(ticket\.key\)\)\}/, 'Siap dikerjain stays on TODO cards only');
});
