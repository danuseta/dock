import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { blackboardFileHref, blackboardHref, fileUrl, folderOf, formatSize, groupFiles, sortFiles, type BlackboardFile } from '../lib/blackboard';
import { hasPage } from '../lib/dockMode';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');
const file = (path: string, kind: BlackboardFile['kind'] = 'text'): BlackboardFile => ({ path, size: 10, updatedAt: '2026-10-26T07:26:00Z', kind, generated: false });

test('files read first come first: NOW, review, decisions, issues, status, then the rest by path; folders group after the top files', () => {
  const files = [file('status.md'), file('tasks.md'), file('screenshots/b.png', 'image'), file('NOW.md'), file('screenshots/a.png', 'image'), file('review.md'), file('prompts/S1.md')];
  assert.deepEqual(sortFiles(files).map((entry) => entry.path), ['NOW.md', 'review.md', 'status.md', 'prompts/S1.md', 'screenshots/a.png', 'screenshots/b.png', 'tasks.md']);
  assert.deepEqual(groupFiles(files).map((group) => [group.folder, group.files.map((entry) => entry.path)]), [
    ['', ['NOW.md', 'review.md', 'status.md', 'tasks.md']],
    ['prompts', ['prompts/S1.md']],
    ['screenshots', ['screenshots/a.png', 'screenshots/b.png']],
  ]);
  assert.equal(folderOf('screenshots/a.png'), 'screenshots');
  assert.equal(folderOf('NOW.md'), '');
});

test('links: the page keeps the ticket and file in its query; file bytes come from the read-only API', () => {
  assert.equal(blackboardHref('QRD-1230'), '/blackboard?key=QRD-1230');
  assert.equal(blackboardFileHref('QRD-1230', 'screenshots'), '/blackboard?key=QRD-1230&file=screenshots');
  assert.equal(fileUrl('QRD-1230', 'screenshots/a b.png', true), '/api/blackboard/QRD-1230/file?path=screenshots%2Fa%20b.png&download=1');
  assert.deepEqual([formatSize(900), formatSize(2048), formatSize(3 * 1024 * 1024)], ['900 B', '2.0 KB', '3.0 MB']);
});

test('the page is a workspace page in the Work group, and the ticket detail and Agents panel link to it', () => {
  assert.equal(hasPage('workspace', '/blackboard'), true);
  assert.equal(hasPage('laptop', '/blackboard'), false, 'the blackboard lives on the workspace');
  assert.match(read('components/AppLayout.tsx'), /\{ path: '\/blackboard', label: 'Blackboard', icon: ClipboardList, badge: 0, group: 'Work' \}/);
  assert.match(read('App.tsx'), /case '\/blackboard': return <BlackboardPage \/>;/);
  const detail = read('pages/TicketDetailPage.tsx');
  assert.match(detail, /useBlackboardFiles\(ticketKey, !monitoring\)/);
  assert.match(detail, /blackboardFiles && <Button[^>]*onClick=\{\(\) => onNavigate\(blackboardHref\(ticket\.key\)\)\}/);
  assert.match(detail, /<h2 className=\{sectionTitle\}>Blackboard<\/h2>/);
  assert.match(read('pages/AgentsPage.tsx'), /useBlackboardFiles\(selected\?\.key, hasPage\(mode, '\/blackboard'\)\)/);
  const page = read('pages/BlackboardPage.tsx');
  assert.match(page, /Read-only/);
  assert.match(page, /Rendered from the ledger by status\.cjs/);
  assert.doesNotMatch(page, /method: 'POST'|method: 'PUT'|method: 'DELETE'/, 'the page never writes');
});

test('the generated marker comment is dropped before markdown is shown', async () => {
  const { withoutComments } = await import('../lib/blackboard');
  assert.equal(withoutComments('<!-- generated, do not edit: `status.cjs render QRD-1230` -->\n# NOW - QRD-1230'), '# NOW - QRD-1230');
});

test('Hide done on the blackboard is the shared Checkbox, and the files list offers the run log', () => {
  const page = read('pages/BlackboardPage.tsx');
  assert.ok(!page.includes('<input type="checkbox"'));
  assert.match(page, /<Checkbox checked=\{hideDone\}/);
  assert.match(page, /setSelected\(LOG_ENTRY\)/);
});
