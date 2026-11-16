import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { movedPageRedirect, opensReportedBugs } from '../lib/movedPages';
import { environmentPreview, imageLinksOf, ISSUE_FILTERS, matchesIssue } from '../lib/dockIssues';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

test('DOCK Issues has no page or sidebar entry: an old /issues link opens Report bug on Reported bugs', () => {
  const app = read('App.tsx');
  assert.doesNotMatch(app, /path === '\/issues'|case '\/issues'/);
  const layout = read('components/AppLayout.tsx');
  assert.doesNotMatch(layout, /label: 'DOCK Issues'/);
  assert.equal(movedPageRedirect('/issues'), '/?report=issues');
  assert.equal(opensReportedBugs('?report=issues'), true);
  assert.equal(opensReportedBugs('?report=new'), false);
  assert.match(layout, /if \(locked \|\| !opensReportedBugs\(window\.location\.search\)\) return;\n {4}setReporting\('issues'\);/);
});

test('Report bug has two tabs, New report and Reported bugs, and New issue in the list goes back to the form', () => {
  const layout = read('components/AppLayout.tsx');
  assert.match(layout, /aria-label="Report bug"/);
  assert.match(layout, /onClick=\{\(\) => setReporting\('new'\)\}/);
  assert.match(layout, /<ReportDockIssue open=\{reporting !== null\} initialTab=\{reporting \?\? 'new'\}/);
  const form = read('components/ReportDockIssue.tsx');
  assert.match(form, /\[\['new', 'New report'\], \['issues', 'Reported bugs'\]\]/);
  assert.match(form, /<DockIssuesBrowser onNewIssue=\{\(\) => setTab\('new'\)\} onOpenSettings=\{openSettings\} \/>/);
  assert.match(read('components/DockIssuesBrowser.tsx'), /onClick=\{onNewIssue\}><Plus size=\{14\} aria-hidden="true" \/>New issue/);
});

test('the form has its fields, the read-only Environment and both buttons', () => {
  const form = read('components/ReportDockIssue.tsx');
  for (const label of ['Title', 'What happened', 'Steps to reproduce', 'Expected', 'Image links \\(one URL per line\\)', 'Environment']) assert.match(form, new RegExp(`<label className=\\{FIELD\\}>${label}`));
  assert.match(form, /<Textarea readOnly value=\{environmentPreview\(/);
  assert.match(form, /Post to GitHub/);
  assert.match(form, /Continue on GitHub/);
  assert.match(form, /Have a screenshot\? Use Continue on GitHub - the form is filled in, just paste the image\./);
  assert.match(form, /const page = window\.location\.pathname/);
  assert.match(form, /disabled=\{!ready \|\| posting \|\| tokenMissing\}/);
  assert.match(form, /GET_DOCK_ISSUE_DRAFT_URL/);
});

test('without a token the form says so, links to Settings and keeps Continue on GitHub enabled', () => {
  const form = read('components/ReportDockIssue.tsx');
  assert.match(form, /\{tokenMissing && \(/);
  assert.match(form, /Add a GitHub token in Settings to post from DOCK\./);
  assert.match(form, /onNavigate\('\/settings'\)/);
  assert.match(form, /<Button onClick=\{\(\) => void continueOnGitHub\(\)\} disabled=\{!ready \|\| posting\}>/);
});

test('a failed post keeps the draft and shows the error, a good one closes the form, toasts and refetches', () => {
  const form = read('components/ReportDockIssue.tsx');
  const failure = form.slice(form.indexOf('} catch (failure)'));
  assert.doesNotMatch(failure.slice(0, failure.indexOf('};')), /setTitle|setHappened|onClose/);
  assert.match(form, /refetchQueries: \['GetDockIssues'\]/);
  assert.match(form, /Posted #\$\{posted\.number\}/);
  assert.match(form, /role="alert">\{error\}/);
});

test('the reported bugs list is read only: tabs, search, detail with Markdown and comments, no close or edit', () => {
  const page = read('components/DockIssuesBrowser.tsx');
  assert.deepEqual(ISSUE_FILTERS.map((entry) => entry.label), ['Open', 'Closed', 'Mine']);
  assert.match(page, /<Markdown text=\{issue\.body\} overrides=\{ISSUE_MARKDOWN\}/);
  assert.match(page, /referrerPolicy="no-referrer"/);
  assert.match(page, /Issue not found/);
  assert.match(page, /Open on GitHub/);
  assert.match(page, /commentList/);
  assert.doesNotMatch(page, /useMutation|[Cc]lose issue/);
});

test('the search matches a title or a number, with or without the #', () => {
  const issue = { number: 142, title: 'Sprint page crashes' };
  assert.equal(matchesIssue(issue, ''), true);
  assert.equal(matchesIssue(issue, ' CRASH '), true);
  assert.equal(matchesIssue(issue, '#142'), true);
  assert.equal(matchesIssue(issue, '14'), true);
  assert.equal(matchesIssue(issue, 'login'), false);
});

test('image links are one per line and the Environment preview names the page, build and mode', () => {
  assert.deepEqual(imageLinksOf('https://a/1.png\n\n  https://a/2.png  \n'), ['https://a/1.png', 'https://a/2.png']);
  assert.equal(environmentPreview('/sprint', 'workspace', '/assets/index-x.js'), 'Page: /sprint\nBuild: /assets/index-x.js\nDOCK_MODE: workspace\nBranch and reporter are added by DOCK.');
  assert.match(environmentPreview('/', 'laptop', null), /Build: unknown/);
});
