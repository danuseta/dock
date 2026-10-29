import assert from 'node:assert/strict';
import test from 'node:test';
import { changesHref, repoName } from '../changes/href';

test('every entry point builds the Changes link with the ticket, the repository and where it came from', () => {
  assert.strictEqual(changesHref('QRD-1189', 'qonekid/ms-admin-worker-backend', 'agents'), '/changes?ticket=QRD-1189&repo=ms-admin-worker-backend&from=agents');
  assert.strictEqual(changesHref('QRD-1189', 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/970', 'discord'), '/changes?ticket=QRD-1189&repo=ms-client-dashboard-frontend&from=discord');
  assert.strictEqual(changesHref('QRD-1189', 'ms-admin-cf-backend', 'ticket'), '/changes?ticket=QRD-1189&repo=ms-admin-cf-backend&from=ticket');
  assert.strictEqual(changesHref('QRD-1189', null, 'board'), '/changes?ticket=QRD-1189&from=board');
  assert.strictEqual(changesHref('QRD-1498', 'ms-client-dashboard-frontend', 'sessions', 'fd3e7b88-7e3f'), '/changes?ticket=QRD-1498&repo=ms-client-dashboard-frontend&from=sessions&session=fd3e7b88-7e3f');
  assert.strictEqual(repoName('dock'), 'dock');
});

test('each place that shows a pull request links to Changes', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../pages/AgentsPage.tsx'), /changesHref\(selected\.key, pr\.repo, 'agents'\)/);
  assert.match(read('../pages/TicketDetailPage.tsx'), /changesHref\(ticket\.key, pr\.repo, 'ticket'\)/);
  assert.match(read('../pages/DiscordPage.tsx'), /changesHref\(ticket\.key, pr, 'discord'\)/);
});
