import assert from 'node:assert';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_DISCORD_MESSAGE_TEMPLATE,
  formatDiscordMessage,
  normalizeDiscordMessageTemplate,
} from '../integrations/discord';
import { buildPullRequestCacheKey, hasCanonicalTicketReference } from '../integrations/github';
import { GoogleCalendarService, normalizeCalendarEvent } from '../integrations/google-calendar';
import { isValidServiceHealthRefreshSeconds, StorageAPI } from '../datasources/StorageAPI';
import { JiraService } from '../integrations/jira';
import { UpstreamMonitorService, validateMonitorTarget } from '../integrations/upstream-monitor';
import { DockerRuntimeService } from '../integrations/docker-runtime';

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
        labels: ['fe-pass', 'needs-review', 'uat_pass'],
      },
    }, 'company.atlassian.net');

    assert.strictEqual(ticket?.projectKey, 'QRD');
    assert.strictEqual(ticket?.projectName, 'Qonflo R&D');
    assert.strictEqual(ticket?.sprintName, 'Sprint 21');
    assert.strictEqual(ticket?.sprintState, 'ACTIVE');
    assert.strictEqual(ticket?.storyPoints, 5);
    assert.deepStrictEqual(ticket?.labels, ['fe-pass', 'needs-review', 'uat_pass']);
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

  await t.test('renders and validates a configurable Discord message template', () => {
    const message = formatDiscordMessage({
      ticket: { key: 'QRD-1099', title: 'Agent workflow', url: 'https://jira.example/QRD-1099' },
      prs: [],
    }, '**{{ticketKey}}** {{ticketTitle}} — {{ticketUrl}}');
    assert.strictEqual(message, '**QRD-1099** Agent workflow — https://jira.example/QRD-1099');
    assert.throws(() => normalizeDiscordMessageTemplate('{{unknownField}}'), /Unsupported Discord template field/);
    assert.throws(() => normalizeDiscordMessageTemplate('x'.repeat(2001)), /too long/);
  });

  await t.test('renders related Jira tickets in one Discord message', () => {
    const message = formatDiscordMessage({
      ticket: { key: 'QRD-475 + QRD-476', title: 'Combined delivery', url: 'https://jira.example/QRD-475' },
      relatedTickets: [
        { key: 'QRD-475', title: 'Backend', url: 'https://jira.example/QRD-475' },
        { key: 'QRD-476', title: 'Frontend', url: 'https://jira.example/QRD-476' },
      ],
      prs: [],
    });
    assert.match(message, /Related Tickets/);
    assert.match(message, /QRD-475/);
    assert.match(message, /QRD-476/);
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

  await t.test('refreshes legacy Jira cache entries missing labels or a reliable assignee', async () => {
    let fetched = 0;
    const storage = {
      getCache: async () => [{ key: 'QRD-1099', assignee: 'Unassigned' }],
      upsertCache: async () => undefined,
    };
    const client = {
      fetchAssignedTickets: async () => {
        fetched += 1;
        return { issues: [{ key: 'QRD-1099', fields: { summary: 'Agent workflow', status: { name: 'IN PROGRESS' }, assignee: { displayName: 'M Danu Seta W' }, labels: ['alvinPass', 'kenPass'] } }] };
      },
    };
    const tickets = await new JiraService(storage as any, client as any).getAssignedTickets(
      { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' },
    );
    assert.strictEqual(fetched, 1);
    assert.strictEqual(tickets[0].assignee, 'M Danu Seta W');
    assert.deepStrictEqual(tickets[0].labels, ['alvinPass', 'kenPass']);
  });

  await t.test('groups ticket dependencies and rejects dependency cycles', async () => {
    const relations = new Map<string, string>([['QRD-476', 'QRD-475']]);
    const storage = {
      getTicketDependencies: async () => [...relations].map(([ticketKey, dependsOnKey]) => ({ ticketKey, dependsOnKey })),
      upsertTicketDependency: async (ticketKey: string, dependsOnKey: string) => { relations.set(ticketKey, dependsOnKey); },
      deleteTicketDependency: async (ticketKey: string) => { relations.delete(ticketKey); },
    };
    const api = new StorageAPI(storage as any);

    assert.deepStrictEqual(await api.getTicketRelationGroup('qrd-476'), {
      primaryKey: 'QRD-475', dependsOnKey: 'QRD-475', ticketKeys: ['QRD-475', 'QRD-476'],
    });
    await assert.rejects(() => api.setTicketDependency('QRD-475', 'QRD-476'), /cycle/);
    assert.deepStrictEqual(await api.clearTicketDependency('QRD-476'), {
      primaryKey: 'QRD-476', dependsOnKey: null, ticketKeys: ['QRD-476'],
    });
  });

  await t.test('scopes PR cache identity to the active GitHub credential', async () => {
    const first = buildPullRequestCacheKey('github-token-one', ['org/repo'], 'QRD-1');
    const second = buildPullRequestCacheKey('github-token-two', ['org/repo'], 'QRD-1');
    assert.notStrictEqual(first, second);
    assert.ok(!first.includes('github-token'));
    assert.ok(!second.includes('github-token'));
  });

  await t.test('matches ticket keys only in canonical PR fields with exact boundaries', () => {
    assert.strictEqual(hasCanonicalTicketReference({
      title: 'QRD-1047 Component Template data model and API',
      body: '',
      head: { ref: 'feat/QRD-1047' },
      comments: [{ body: 'folder support landing in QRD-1055' }],
    }, 'QRD-1055'), false);
    assert.strictEqual(hasCanonicalTicketReference({
      title: 'Add folder support',
      body: 'Implements QRD-1055.',
      head: { ref: 'feature/component-template-folders' },
    }, 'QRD-1055'), true);
    assert.strictEqual(hasCanonicalTicketReference({
      title: 'Add folder support',
      body: '',
      head: { ref: 'feature/QRD-1055-component-template-folders' },
    }, 'QRD-1055'), true);
    assert.strictEqual(hasCanonicalTicketReference({ title: 'Follow-up QRD-10550' }, 'QRD-1055'), false);
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

  await t.test('persists OAuth state so a callback survives an app restart', async () => {
    const cache = new Map<string, unknown>();
    const settings = [
      { key: 'googleClientId', value: 'client-id.apps.googleusercontent.com' },
      { key: 'googleClientSecret', value: 'client-secret' },
    ];
    const makeStorage = () => ({
      getSettings: async () => settings,
      upsertCache: async (namespace: string, key: string, value: unknown) => cache.set(`${namespace}:${key}`, value),
      getCache: async (namespace: string, key: string) => cache.get(`${namespace}:${key}`) ?? null,
      deleteCache: async (namespace: string, key: string) => { cache.delete(`${namespace}:${key}`); },
      upsertSetting: async () => undefined,
    });
    const firstService = new GoogleCalendarService(makeStorage() as any);
    const authorization = new URL(await firstService.authorizationUrl('https://jidis.test/auth/google/callback'));
    const state = authorization.searchParams.get('state');
    assert.ok(state);

    const originalPost = axios.post;
    (axios as any).post = async () => ({ data: { refresh_token: 'refresh-token' } });
    try {
      await new GoogleCalendarService(makeStorage() as any).completeAuthorization(
        'authorization-code', state, 'https://jidis.test/auth/google/callback',
      );
    } finally {
      axios.post = originalPost;
    }
    assert.strictEqual(cache.get('google-oauth-state:' + state), undefined);
  });

  await t.test('accepts a reauthorization response without replacing an existing refresh token', async () => {
    let writes = 0;
    const storage = {
      getSettings: async () => [
        { key: 'googleClientId', value: 'client-id.apps.googleusercontent.com' },
        { key: 'googleClientSecret', value: 'client-secret' },
        { key: 'googleRefreshToken', value: 'existing-refresh-token' },
      ],
      upsertSetting: async () => { writes += 1; },
    };
    const service = new GoogleCalendarService(storage as any);
    const authorization = new URL(await service.authorizationUrl('https://jidis.test/auth/google/callback'));
    const state = authorization.searchParams.get('state');
    assert.ok(state);
    const originalPost = axios.post;
    (axios as any).post = async () => ({ data: { access_token: 'access-token' } });
    try {
      await service.completeAuthorization('authorization-code', state, 'https://jidis.test/auth/google/callback');
    } finally {
      axios.post = originalPost;
    }
    assert.strictEqual(writes, 0);
  });

  await t.test('keeps OAuth state available when callback credentials are missing', async () => {
    const cache = new Map<string, unknown>();
    const settings = [
      { key: 'googleClientId', value: 'client-id.apps.googleusercontent.com' },
      { key: 'googleClientSecret', value: 'client-secret' },
    ];
    const storage = {
      getSettings: async () => settings,
      upsertCache: async (namespace: string, key: string, value: unknown) => cache.set(`${namespace}:${key}`, value),
      getCache: async (namespace: string, key: string) => cache.get(`${namespace}:${key}`) ?? null,
      deleteCache: async (namespace: string, key: string) => { cache.delete(`${namespace}:${key}`); },
      upsertSetting: async () => undefined,
    };
    const service = new GoogleCalendarService(storage as any);
    const authorization = new URL(await service.authorizationUrl('https://jidis.test/auth/google/callback'));
    const state = authorization.searchParams.get('state');
    assert.ok(state);
    settings.splice(1, 1);

    await assert.rejects(
      service.completeAuthorization('authorization-code', state, 'https://jidis.test/auth/google/callback'),
      /Google OAuth is not configured/,
    );
    assert.strictEqual(cache.get('google-oauth-state:' + state), state);
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

  await t.test('serves cached Google Calendar events without refreshing an access token', async () => {
    const cachedEvents = [{
      id: 'event-cached', title: 'Cached focus block', start: '2026-08-29T09:00:00Z', end: null,
      allDay: false, location: null, url: null, calendarId: 'primary',
    }];
    let cacheKey = '';
    const storage = {
      getSettings: async () => [
        { key: 'googleClientId', value: 'client-id.apps.googleusercontent.com' },
        { key: 'googleClientSecret', value: 'client-secret' },
        { key: 'googleRefreshToken', value: 'refresh-token' },
        { key: 'googleCalendarId', value: 'primary' },
      ],
      getCache: async (namespace: string, key: string) => {
        assert.strictEqual(namespace, 'google-calendar');
        cacheKey = key;
        return cachedEvents;
      },
    };
    const originalPost = axios.post;
    (axios as any).post = async () => { throw new Error('access token refresh should not run on a cache hit'); };

    try {
      const result = await new GoogleCalendarService(storage as any).listEvents(
        '2026-08-29T00:00:00.000Z',
        '2026-08-30T00:00:00.000Z',
        25,
      );
      assert.deepStrictEqual(result, cachedEvents);
      assert.match(cacheKey, /primary/);
    } finally {
      axios.post = originalPost;
    }
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

  await t.test('exposes a default Discord template and rejects invalid template settings', async () => {
    const writes: Array<[string, string]> = [];
    const storage = {
      getSettings: async () => [],
      hasMasterPin: async () => false,
      upsertSetting: async (key: string, value: string) => { writes.push([key, value]); },
    };
    const api = new StorageAPI(storage as any);

    assert.strictEqual((await api.getPublicSettings()).discordMessageTemplate, DEFAULT_DISCORD_MESSAGE_TEMPLATE);
    assert.strictEqual(await api.updateSettings({ discordMessageTemplate: '{{unknownField}}' }), false);
    assert.deepStrictEqual(writes, []);
    assert.strictEqual(await api.updateSettings({ discordMessageTemplate: '**{{ticketKey}}**' }), true);
    assert.deepStrictEqual(writes, [['discordMessageTemplate', '**{{ticketKey}}**']]);
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

  await t.test('maps Docker inventory without exposing a writable API', async () => {
    const calls: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/info')) return new Response(JSON.stringify({ Name: 'danuseta', ServerVersion: '28.0.1', Images: 7 }));
      return new Response(JSON.stringify([{
        Id: 'a'.repeat(64), Names: ['/dock-app-1'], Image: 'ghcr.io/danuseta/dock:latest', Command: 'node dist/index.js',
        Created: Math.floor(Date.now() / 1000) - 3600, State: 'running', Status: 'Up 1 hour',
        Ports: [{ PrivatePort: 4000, PublicPort: 3101, Type: 'tcp', IP: '127.0.0.1' }],
        Labels: { 'com.docker.compose.project': 'dock' },
      }]));
    };
    const runtime = await new DockerRuntimeService(fetcher as typeof fetch, 'http://docker.test').runtime();
    assert.strictEqual(runtime.available, true);
    assert.strictEqual(runtime.running, 1);
    assert.strictEqual(runtime.containers[0].project, 'dock');
    assert.deepStrictEqual(runtime.containers[0].ports, ['127.0.0.1:3101 → 4000/tcp']);
    assert.ok(calls.every((url) => url.endsWith('/info') || url.includes('/containers/json?all=1')));
  });

  await t.test('rejects arbitrary Docker log paths and bounds the tail size', async () => {
    let requestedUrl = '';
    const fetcher = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response('2026-08-30T00:00:00Z ready\n');
    };
    const service = new DockerRuntimeService(fetcher as typeof fetch, 'http://docker.test');
    await assert.rejects(() => service.logs('../info', 5), /Invalid container ID/);
    const logs = await service.logs('b'.repeat(64), 10_000);
    assert.match(requestedUrl, /tail=200$/);
    assert.match(logs, /ready/);
  });
});
