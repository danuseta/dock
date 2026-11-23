import assert from 'node:assert/strict';
import test from 'node:test';
import { changesHref, changesRedirect, repoName } from '../changes/href';

test('every entry point links to Perubahan kode in the ticket\'s Blackboard, with the repository and where it came from', () => {
  assert.strictEqual(changesHref('QRD-1189', 'qonekid/ms-admin-worker-backend', 'agents'), '/blackboard?key=QRD-1189&file=pr%3Ams-admin-worker-backend&from=agents');
  assert.strictEqual(changesHref('QRD-1189', 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/970', 'discord'), '/blackboard?key=QRD-1189&file=pr%3Ams-client-dashboard-frontend&from=discord');
  assert.strictEqual(changesHref('QRD-1189', 'ms-admin-cf-backend', 'ticket'), '/blackboard?key=QRD-1189&file=pr%3Ams-admin-cf-backend&from=ticket');
  assert.strictEqual(changesHref('QRD-1189', null, 'board'), '/blackboard?key=QRD-1189&file=pr%3A&from=board');
  assert.strictEqual(changesHref('QRD-1498', 'ms-client-dashboard-frontend', 'sessions', 'fd3e7b88-7e3f'), '/blackboard?key=QRD-1498&file=pr%3Ams-client-dashboard-frontend&from=sessions&session=fd3e7b88-7e3f');
  assert.strictEqual(repoName('dock'), 'dock');
});

test('an old /changes link redirects to the same pull request and file in Blackboard', () => {
  assert.strictEqual(changesRedirect('?ticket=QRD-1292&repo=ms-client-dashboard-frontend&from=agents'), '/blackboard?key=QRD-1292&file=pr%3Ams-client-dashboard-frontend&from=agents');
  assert.strictEqual(changesRedirect('?ticket=QRD-1292&repo=ms-admin-worker-backend&from=ticket&file=src%2Fservices%2Fskill-version.service.ts'), '/blackboard?key=QRD-1292&file=pr%3Ams-admin-worker-backend&from=ticket&path=src%2Fservices%2Fskill-version.service.ts');
  assert.strictEqual(changesRedirect('?ticket=QRD-1498&repo=ms-client-dashboard-frontend&from=sessions&session=fd3e'), '/blackboard?key=QRD-1498&file=pr%3Ams-client-dashboard-frontend&from=sessions&session=fd3e');
  assert.strictEqual(changesRedirect('?ticket=QRD-1189'), '/blackboard?key=QRD-1189&file=pr%3A&from=board');
  assert.strictEqual(changesRedirect(''), '/blackboard');
});

test('each place that shows a pull request links through changesHref, and /changes redirects on load and on navigation', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../pages/AgentsPage.tsx'), /changesHref\(selected\.key, pr\.repo, 'agents'\)/);
  assert.match(read('../pages/TicketDetailPage.tsx'), /changesHref\(ticket\.key, pr\.repo, 'ticket'\)/);
  assert.match(read('../pages/DiscordPage.tsx'), /changesHref\(ticket\.key, pr, 'discord'\)/);
  assert.match(read('../chat/SessionInspector.tsx'), /changesHref\(ticketKey, changesRepo, 'sessions', session\.id\)/);
  const app = read('../App.tsx');
  assert.match(app, /if \(window\.location\.pathname === '\/changes'\) window\.history\.replaceState\(window\.history\.state, '', changesRedirect\(window\.location\.search\)\);/);
  assert.match(app, /to\.startsWith\('\/changes'\) \? changesRedirect\(/);
});
