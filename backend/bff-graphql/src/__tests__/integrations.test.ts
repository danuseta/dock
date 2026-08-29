import assert from 'node:assert';
import test from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { formatDiscordMessage } from '../integrations/discord';
import { buildPullRequestCacheKey } from '../integrations/github';
import { GoogleCalendarService, normalizeCalendarEvent } from '../integrations/google-calendar';
import { isValidServiceHealthRefreshSeconds, StorageAPI } from '../datasources/StorageAPI';
import { JiraService } from '../integrations/jira';
import { UpstreamMonitorService, validateMonitorTarget } from '../integrations/upstream-monitor';

test('internal integration behavior', async (t) => {
  await t.test('formats Jira ADF, project metadata, sprint, and story points', () => {
    const service = new JiraService({} as any, {} as any);
    const ticket = service.formatTicket({
      key: 'QRD-205',
      fields: {
        summary: 'Move integrations into BFF',
        status: { name: 'IN PROGRESS' },
        project: { key: 'QRD', name: 'Qonflo R&D' },
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Internal call only' }] }] },
        customfield_10020: [{ name: 'Sprint 21', state: 'active', startDate: '2026-08-01' }],
        customfield_10016: 5,
      },
    }, 'company.atlassian.net');

    assert.strictEqual(ticket?.projectKey, 'QRD');
    assert.strictEqual(ticket?.projectName, 'Qonflo R&D');
    assert.strictEqual(ticket?.sprintName, 'Sprint 21');
    assert.strictEqual(ticket?.sprintState, 'ACTIVE');
    assert.strictEqual(ticket?.storyPoints, 5);
    assert.match(ticket?.description || '', /Internal call only/);
  });

  await t.test('includes Jira, PR, and demo links in Discord summary', () => {
    const message = formatDiscordMessage({
      ticket: { key: 'QRD-205', title: 'Monolith', url: 'https://jira.example/browse/QRD-205' },
      prs: [{ repo: 'org/api', title: 'QRD-205 API', url: 'https://github.example/pr/1', status: 'open' }],
      demoUrl: 'https://demo.example/205',
    });
    assert.match(message, /QRD-205/);
    assert.match(message, /org\/api/);
    assert.match(message, /demo\.example/);
  });

  await t.test('passes the selected Jira projects to assigned-ticket lookup and cache identity', async () => {
    const cacheKeys: string[] = [];
    let receivedProjects: string[] = [];
    const storage = {
      getCache: async () => null,
      upsertCache: async (_namespace: string, key: string) => { cacheKeys.push(key); },
    };
    const client = {
      fetchAssignedTickets: async (_credentials: any, projectKeys: string[]) => {
        receivedProjects = projectKeys;
        return { issues: [] };
      },
    };
    const service = new JiraService(storage as any, client as any);
    await service.getAssignedTickets(
      { domain: 'https://company.atlassian.net/', email: 'me@example.test', apiToken: 'secret' },
      ['qrd', 'INVALID KEY', 'OPS'],
    );

    assert.deepStrictEqual(receivedProjects, ['QRD', 'OPS']);
    assert.match(cacheKeys[0], /QRD-OPS/);
  });

  await t.test('scopes PR cache identity to the active GitHub credential', async () => {
    const first = buildPullRequestCacheKey('github-token-one', ['org/repo'], 'QRD-1');
    const second = buildPullRequestCacheKey('github-token-two', ['org/repo'], 'QRD-1');
    assert.notStrictEqual(first, second);
    assert.ok(!first.includes('github-token'));
    assert.ok(!second.includes('github-token'));
  });

  await t.test('builds a least-privilege offline Google Calendar OAuth URL', async () => {
    const storage = {
      getSettings: async () => [
        { key: 'googleClientId', value: 'client-id.apps.googleusercontent.com' },
        { key: 'googleClientSecret', value: 'client-secret' },
      ],
    };
    const service = new GoogleCalendarService(storage as any);
    const url = new URL(await service.authorizationUrl('https://jidis.test/auth/google/callback'));
    assert.strictEqual(url.origin, 'https://accounts.google.com');
    assert.strictEqual(url.searchParams.get('access_type'), 'offline');
    assert.strictEqual(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.readonly');
    assert.ok(url.searchParams.get('state'));
  });

  await t.test('normalizes timed and all-day Google Calendar events', () => {
    const event = normalizeCalendarEvent({
      id: 'event-1', summary: 'Focus block', start: { date: '2026-08-28' }, end: { date: '2026-08-29' },
    }, 'primary');
    assert.deepStrictEqual(event, {
      id: 'event-1', title: 'Focus block', start: '2026-08-28', end: '2026-08-29',
      allDay: true, location: null, url: null, calendarId: 'primary',
    });
  });

  await t.test('accepts only HTTP(S) quick-link targets', async () => {
    const storage = { createQuickLink: async (input: any) => ({ id: 'link-1', ...input, position: 0 }) };
    const api = new StorageAPI(storage as any);
    await assert.rejects(() => api.addQuickLink({ title: 'Unsafe', url: 'javascript:alert(1)' }));
    await assert.rejects(() => api.addQuickLink({ title: 'Incomplete', url: 'https://' }));
    const link = await api.addQuickLink({ title: 'GitHub', url: 'https://github.com', color: '#60a5fa' });
    assert.strictEqual(link.url, 'https://github.com');
  });

  await t.test('accepts bounded manual service-health refresh intervals', () => {
    assert.strictEqual(isValidServiceHealthRefreshSeconds(5), true);
    assert.strictEqual(isValidServiceHealthRefreshSeconds(37), true);
    assert.strictEqual(isValidServiceHealthRefreshSeconds(86_400), true);
    assert.strictEqual(isValidServiceHealthRefreshSeconds(4), false);
    assert.strictEqual(isValidServiceHealthRefreshSeconds(5.5), false);
    assert.strictEqual(isValidServiceHealthRefreshSeconds(86_401), false);
  });

  await t.test('validates bounded credential-free upstream targets', () => {
    assert.throws(() => validateMonitorTarget({ name: 'FTP', url: 'ftp://example.com' }));
    assert.throws(() => validateMonitorTarget({ name: 'Secret', url: 'https://user:pass@example.com' }));
    assert.throws(() => validateMonitorTarget({ name: 'Slow', url: 'https://example.com', timeoutMs: 30000 }));
    assert.deepStrictEqual(validateMonitorTarget({ name: ' Portfolio ', url: 'https://example.com/health' }), {
      name: 'Portfolio', url: 'https://example.com/health', expectedStatus: 200, timeoutMs: 5000,
    });
  });

  await t.test('validates monitor edits before persistence', async () => {
    let saved: any;
    const storage = {
      updateMonitorTarget: async (id: string, input: any) => { saved = { id, ...input }; return saved; },
    };
    const service = new UpstreamMonitorService(storage as any);
    await assert.rejects(() => service.update('monitor-1', { name: 'Unsafe', url: 'javascript:alert(1)' }));
    const updated = await service.update('monitor-1', {
      name: ' Portfolio ', url: 'https://example.com/status', expectedStatus: 204, timeoutMs: 3000,
    });
    assert.deepStrictEqual(updated, {
      id: 'monitor-1', name: 'Portfolio', url: 'https://example.com/status', expectedStatus: 204, timeoutMs: 3000,
    });
  });

  await t.test('persists upstream probe status and latency', async () => {
    let saved: any;
    const storage = {
      getMonitorTarget: async () => ({ id: 'monitor-1', url: 'https://example.com/health', expectedStatus: 200, timeoutMs: 1000 }),
      updateMonitorResult: async (_id: string, result: any) => { saved = result; return { id: 'monitor-1', ...result }; },
    };
    let bodyDestroyed = false;
    const http = { get: async () => ({ status: 200, data: { destroy: () => { bodyDestroyed = true; } } }) };
    const service = new UpstreamMonitorService(storage as any, http as any);
    const result = await service.check('monitor-1');
    assert.strictEqual(result.lastStatus, 'UP');
    assert.strictEqual(saved.lastStatusCode, 200);
    assert.strictEqual(bodyDestroyed, true);
  });

  await t.test('probes a real HTTP health endpoint without reading its body', async (probeTest) => {
    const server = createServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    probeTest.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const port = (server.address() as AddressInfo).port;
    const storage = {
      getMonitorTarget: async () => ({ id: 'monitor-http', url: `http://127.0.0.1:${port}/health`, expectedStatus: 204, timeoutMs: 1000 }),
      updateMonitorResult: async (_id: string, result: any) => ({ id: 'monitor-http', ...result }),
    };
    const result = await new UpstreamMonitorService(storage as any).check('monitor-http');
    assert.strictEqual(result.lastStatus, 'UP');
    assert.strictEqual(result.lastStatusCode, 204);
  });
});
