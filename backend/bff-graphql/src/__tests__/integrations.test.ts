import assert from 'node:assert';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  buildDiscordForumTitle,
  DEFAULT_DISCORD_MESSAGE_TEMPLATE,
  describeDiscordError,
  DiscordService,
  formatDiscordMessage,
  normalizeDiscordMessageTemplate,
} from '../integrations/discord';
import { buildPullRequestCacheKey, hasCanonicalTicketReference } from '../integrations/github';
import { CalendarUnavailableError, GoogleCalendarService, normalizeCalendarEvent } from '../integrations/google-calendar';
import { isValidServiceHealthRefreshSeconds, StorageAPI } from '../datasources/StorageAPI';
import { JiraService } from '../integrations/jira';
import { JiraAPI, JiraTicketLookupError } from '../datasources/JiraAPI';
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
    assert.strictEqual(ticket?.acceptanceCriteria, null);
  });

  await t.test('reads the Jira Acceptance Criteria field as text', () => {
    const service = new JiraService({} as any, {} as any);
    const adf = service.formatTicket({
      key: 'QRD-1242',
      fields: {
        summary: 'Tool registration',
        customfield_10332: { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The tool set is rebuilt between steps' }] }] }] }] },
      },
    }, 'company.atlassian.net');
    assert.match(adf?.acceptanceCriteria || '', /The tool set is rebuilt between steps/);
    const plain = service.formatTicket({ key: 'QRD-1', fields: { customfield_10332: '* Button saves the form\n' } }, 'company.atlassian.net');
    assert.strictEqual(plain?.acceptanceCriteria, '* Button saves the form');
    const blank = service.formatTicket({ key: 'QRD-2', fields: { customfield_10332: '   ' } }, 'company.atlassian.net');
    assert.strictEqual(blank?.acceptanceCriteria, null);
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
    assert.doesNotMatch(message, /OPEN|🟢|Demo Video|🎬/);
    assert.match(message, /\[org\/api\] - \[QRD-205 API\]/);
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

  await t.test('repeats every ticket line once per ticket in a dependency group', () => {
    const message = formatDiscordMessage({
      ticket: { key: 'QRD-476', title: 'Backend threads', url: 'https://jira.example/QRD-476' },
      relatedTickets: [
        { key: 'QRD-476', title: 'Backend threads', url: 'https://jira.example/QRD-476' },
        { key: 'QRD-475', title: 'Frontend panel', url: 'https://jira.example/QRD-475' },
      ],
      prs: [],
    }, '{{ticketKey}} - {{ticketTitle}}\n\nJira :\n[{{ticketKey}}]({{ticketUrl}})');
    assert.match(message, /^QRD-476 - Backend threads\nQRD-475 - Frontend panel$/m);
    assert.match(message, /^\[QRD-476\]\(https:\/\/jira\.example\/QRD-476\)\n\[QRD-475\]\(https:\/\/jira\.example\/QRD-475\)$/m);
    assert.doesNotMatch(message, /\(\+1 related\)/);
  });

  await t.test('still renders the optional related ticket block', () => {
    const message = formatDiscordMessage({
      ticket: { key: 'QRD-476', title: 'Backend threads', url: 'https://jira.example/QRD-476' },
      relatedTickets: [
        { key: 'QRD-476', title: 'Backend threads', url: 'https://jira.example/QRD-476' },
        { key: 'QRD-475', title: 'Frontend panel', url: 'https://jira.example/QRD-475' },
      ],
      prs: [],
    }, '{{relatedTickets}}');
    assert.match(message, /Related Tickets/);
    assert.match(message, /- \[QRD-475\]\(https:\/\/jira\.example\/QRD-475\) — Frontend panel/);
  });

  await t.test('retries a forum webhook once with an automatic post title', async (forumTest) => {
    const bodies: any[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        bodies.push(JSON.parse(body));
        if (bodies.length === 1) {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ code: 220001, message: 'A thread_name or thread_id is required' }));
          return;
        }
        response.writeHead(204);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forumTest.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const port = (server.address() as AddressInfo).port;
    const ticket = { key: 'QRD-1055', title: '[BE] Component Template: folder support', url: 'https://jira.example/QRD-1055' };

    await new DiscordService().sendSummary({ ticket, prs: [] }, `http://127.0.0.1:${port}/webhook`);

    assert.strictEqual(bodies.length, 2);
    assert.strictEqual(bodies[0].thread_name, undefined);
    assert.strictEqual(bodies[1].thread_name, buildDiscordForumTitle(ticket));
  });

  await t.test('sanitizes Discord transport errors before logging', () => {
    const error = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      config: { url: 'https://discord.com/api/webhooks/id/secret-token' },
      response: { status: 400, data: { code: 220001, message: 'A thread_name or thread_id is required' } },
    });
    const details = describeDiscordError(error);
    assert.deepStrictEqual(details, {
      status: 400,
      code: 220001,
      message: 'A thread_name or thread_id is required',
    });
    assert.doesNotMatch(JSON.stringify(details), /secret-token/);
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

  await t.test('revalidates cached assigned Jira tickets in the background and re-upserts', async () => {
    const cachedTickets = [{ key: 'QRD-1', title: 'Cached', status: 'TODO', assignee: 'M Danu Seta W', labels: ['alvinPass'] }];
    let fetchCalls = 0;
    let upserted: any = null;
    const storage = {
      getCache: async () => cachedTickets,
      upsertCache: async (_namespace: string, _key: string, value: unknown) => { upserted = value; },
    };
    const client = {
      fetchAssignedTickets: async () => {
        fetchCalls += 1;
        return { issues: [{ key: 'QRD-1', fields: { summary: 'Fresh', status: { name: 'DONE' }, assignee: { displayName: 'M Danu Seta W' }, labels: ['alvinPass'] } }] };
      },
    };
    const service = new JiraService(storage as any, client as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };

    const tickets = await service.getAssignedTickets(credentials);
    assert.strictEqual(tickets, cachedTickets);

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(fetchCalls, 1);
    assert.strictEqual(upserted?.[0]?.status, 'DONE');
  });

  await t.test('does not revalidate cached assigned Jira tickets again inside the revalidation window', async () => {
    let fetchCalls = 0;
    const freshTicket = { key: 'QRD-2', title: 'Fresh', status: 'TODO', assignee: 'M Danu Seta W', labels: ['alvinPass'] };
    const storage: { getCache: () => Promise<any>; upsertCache: () => Promise<void> } = {
      getCache: async () => null,
      upsertCache: async () => undefined,
    };
    const client = {
      fetchAssignedTickets: async () => {
        fetchCalls += 1;
        return { issues: [{ key: 'QRD-2', fields: { summary: 'Fresh', status: { name: 'TODO' }, assignee: { displayName: 'M Danu Seta W' }, labels: ['alvinPass'] } }] };
      },
    };
    const service = new JiraService(storage as any, client as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };

    await service.getAssignedTickets(credentials);
    assert.strictEqual(fetchCalls, 1);

    storage.getCache = async () => [freshTicket];
    await service.getAssignedTickets(credentials);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(fetchCalls, 1);
  });

  await t.test('serves cached Jira assigned tickets without waiting on a background Jira revalidation', async () => {
    const cachedTickets = [{ key: 'QRD-5', title: 'Cached', status: 'TODO', assignee: 'M Danu Seta W', labels: ['alvinPass'] }];
    let jiraCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = new JiraService({
      getCache: async () => cachedTickets,
      upsertCache: async () => undefined,
    } as any, {
      fetchAssignedTickets: async () => { jiraCalls += 1; await gate; return { issues: [] }; },
    } as any);

    assert.deepStrictEqual(await service.getAssignedTickets({
      domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret',
    }), cachedTickets);

    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(jiraCalls, 1);
  });

  await t.test('revalidates once the cache entry crosses the 45s staleness boundary', async () => {
    let fetchCalls = 0;
    const freshTicket = { key: 'QRD-6', title: 'Fresh', status: 'TODO', assignee: 'M Danu Seta W', labels: ['alvinPass'] };
    const storage: { getCache: () => Promise<any>; upsertCache: () => Promise<void> } = {
      getCache: async () => null,
      upsertCache: async () => undefined,
    };
    const client = {
      fetchAssignedTickets: async () => {
        fetchCalls += 1;
        return { issues: [{ key: 'QRD-6', fields: { summary: 'Fresh', status: { name: 'TODO' }, assignee: { displayName: 'M Danu Seta W' }, labels: ['alvinPass'] } }] };
      },
    };
    const service = new JiraService(storage as any, client as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };

    await service.getAssignedTickets(credentials);
    assert.strictEqual(fetchCalls, 1);

    storage.getCache = async () => [freshTicket];
    const originalDateNow = Date.now;
    try {
      const realNow = originalDateNow();
      Date.now = () => realNow + 46_000;
      await service.getAssignedTickets(credentials);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(fetchCalls, 2);
    } finally {
      Date.now = originalDateNow;
    }
  });

  await t.test('forceRefresh does not join an in-flight background revalidation', async () => {
    const cachedTickets = [{ key: 'QRD-7', title: 'Cached', status: 'TODO', assignee: 'M Danu Seta W', labels: ['alvinPass'] }];
    let clientCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const storage = {
      getCache: async () => cachedTickets,
      upsertCache: async () => undefined,
    };
    const client = {
      fetchAssignedTickets: async () => {
        clientCalls += 1;
        await gate;
        return { issues: [] };
      },
    };
    const service = new JiraService(storage as any, client as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };

    const first = await service.getAssignedTickets(credentials);
    assert.strictEqual(first, cachedTickets);
    assert.strictEqual(clientCalls, 1);

    const second = service.getAssignedTickets(credentials, [], true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(clientCalls, 1);

    release();
    await second;
    assert.strictEqual(clientCalls, 2);
  });

  await t.test('a forced refresh waits out an in-flight background revalidation and lands last', async () => {
    const cachedTickets = [{ key: 'QRD-8', title: 'Cached', status: 'TODO', assignee: 'M Danu Seta W', labels: ['alvinPass'] }];
    let clientCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const upserts: string[] = [];
    const storage = {
      getCache: async () => cachedTickets,
      upsertCache: async (_namespace: string, _key: string, value: any) => { upserts.push(value[0].status); },
    };
    const client = {
      fetchAssignedTickets: async () => {
        clientCalls += 1;
        if (clientCalls === 1) {
          await gate;
          return { issues: [{ key: 'QRD-8', fields: { summary: 'Old', status: { name: 'OLD' }, assignee: { displayName: 'M Danu Seta W' }, labels: ['alvinPass'] } }] };
        }
        return { issues: [{ key: 'QRD-8', fields: { summary: 'New', status: { name: 'NEW' }, assignee: { displayName: 'M Danu Seta W' }, labels: ['alvinPass'] } }] };
      },
    };
    const service = new JiraService(storage as any, client as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };

    const background = await service.getAssignedTickets(credentials);
    assert.strictEqual(background, cachedTickets);
    assert.strictEqual(clientCalls, 1);

    const forced = service.getAssignedTickets(credentials, [], true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(clientCalls, 1);

    release();
    const forcedResult = await forced;
    assert.strictEqual(clientCalls, 2);
    assert.deepStrictEqual(upserts, ['OLD', 'NEW']);
    assert.strictEqual(forcedResult[0].status, 'NEW');
  });

  await t.test('serves cached Jira ticket details without waiting on a background Jira revalidation', async () => {
    const cachedTicket = { key: 'QRD-1148', title: 'Cached detail', status: 'IN PROGRESS' };
    let jiraCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = new JiraService({
      getCache: async (namespace: string, key: string) => {
        assert.strictEqual(namespace, 'jira');
        assert.match(key, /ticket_detail_company\.atlassian\.net_me@example\.test_QRD-1148/);
        return cachedTicket;
      },
      upsertCache: async () => undefined,
    } as any, {
      getTicketDetails: async () => { jiraCalls += 1; await gate; return null; },
    } as any);

    assert.deepStrictEqual(await service.getTicketDetails({
      domain: 'https://company.atlassian.net/', email: 'me@example.test', apiToken: 'secret',
    }, 'qrd-1148'), cachedTicket);

    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(jiraCalls, 1);
  });

  await t.test('revalidates cached Jira ticket details in the background and re-upserts', async () => {
    const cachedTicket = { key: 'QRD-1148', title: 'Cached detail', status: 'IN PROGRESS' };
    let fetchCalls = 0;
    let upserted: any = null;
    const storage = {
      getCache: async () => cachedTicket,
      upsertCache: async (_namespace: string, _key: string, value: unknown) => { upserted = value; },
    };
    const client = {
      getTicketDetails: async () => {
        fetchCalls += 1;
        return { key: 'QRD-1148', fields: { summary: 'Fresh detail', status: { name: 'DONE' } } };
      },
    };
    const service = new JiraService(storage as any, client as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };

    const ticket = await service.getTicketDetails(credentials, 'QRD-1148');
    assert.deepStrictEqual(ticket, cachedTicket);

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(fetchCalls, 1);
    assert.strictEqual(upserted?.status, 'DONE');
  });

  await t.test('does not revalidate cached Jira ticket details again inside the revalidation window', async () => {
    let fetchCalls = 0;
    const storage: { getCache: () => Promise<any>; upsertCache: () => Promise<void> } = {
      getCache: async () => null,
      upsertCache: async () => undefined,
    };
    const client = {
      getTicketDetails: async () => {
        fetchCalls += 1;
        return { key: 'QRD-1148', fields: { summary: 'Fresh detail', status: { name: 'TODO' } } };
      },
    };
    const service = new JiraService(storage as any, client as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };

    await service.getTicketDetails(credentials, 'QRD-1148');
    assert.strictEqual(fetchCalls, 1);

    storage.getCache = async () => ({ key: 'QRD-1148', title: 'Fresh detail', status: 'TODO' });
    await service.getTicketDetails(credentials, 'QRD-1148');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(fetchCalls, 1);
  });

  await t.test('keeps serving cached Jira ticket details when a background revalidation rejects', async () => {
    const cachedTicket = { key: 'QRD-1148', title: 'Cached detail', status: 'IN PROGRESS' };
    let fetchCalls = 0;
    const storage = {
      getCache: async () => cachedTicket,
      upsertCache: async () => undefined,
    };
    const client = {
      getTicketDetails: async () => {
        fetchCalls += 1;
        throw new Error('Jira upstream unavailable');
      },
    };
    const service = new JiraService(storage as any, client as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };

    let unhandledRejections = 0;
    const onUnhandledRejection = () => { unhandledRejections += 1; };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const ticket = await service.getTicketDetails(credentials, 'QRD-1148');
      assert.deepStrictEqual(ticket, cachedTicket);
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
    assert.strictEqual(fetchCalls, 1);
    assert.strictEqual(unhandledRejections, 0);
  });

  await t.test('throttles further upstream calls after a rejecting background revalidation', async () => {
    const cachedTicket = { key: 'QRD-1200', title: 'Cached detail', status: 'IN PROGRESS' };
    let fetchCalls = 0;
    const storage = {
      getCache: async () => cachedTicket,
      upsertCache: async () => undefined,
    };
    const client = {
      getTicketDetails: async () => {
        fetchCalls += 1;
        throw new Error('Jira upstream unavailable');
      },
    };
    const service = new JiraService(storage as any, client as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };

    let unhandledRejections = 0;
    const onUnhandledRejection = () => { unhandledRejections += 1; };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      await service.getTicketDetails(credentials, 'QRD-1200');
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(fetchCalls, 1);

      await service.getTicketDetails(credentials, 'QRD-1200');
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(fetchCalls, 1);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
    assert.strictEqual(unhandledRejections, 0);
  });

  await t.test('deduplicates concurrent Jira ticket detail lookups', async () => {
    let jiraCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = new JiraService({
      getCache: async () => null,
      upsertCache: async () => undefined,
    } as any, {
      getTicketDetails: async () => {
        jiraCalls += 1;
        await gate;
        return { key: 'QRD-1148', fields: { summary: 'Deduplicated', status: { name: 'TODO' } } };
      },
    } as any);
    const credentials = { domain: 'company.atlassian.net', email: 'me@example.test', apiToken: 'secret' };
    const first = service.getTicketDetails(credentials, 'QRD-1148');
    const second = service.getTicketDetails(credentials, 'qrd-1148');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(jiraCalls, 1);
    release();
    const [firstTicket, secondTicket] = await Promise.all([first, second]);
    assert.strictEqual(firstTicket.title, 'Deduplicated');
    assert.deepStrictEqual(secondTicket, firstTicket);
  });

  await t.test('distinguishes a missing Jira ticket from an upstream lookup failure', async () => {
    const api = new JiraAPI();
    (api as any).storageAPI = { getSettings: async () => ({ jiraUrl: 'example.atlassian.net', jiraEmail: 'me@example.test', jiraApiToken: 'secret' }) };
    (api as any).jiraService = {
      getTicketDetails: async () => {
        throw Object.assign(new Error('missing'), { response: { status: 404 } });
      },
    };
    assert.strictEqual(await api.getTicket('QRD-404'), null);

    (api as any).jiraService = {
      getTicketDetails: async () => {
        throw Object.assign(new Error('gateway timeout'), { response: { status: 504 } });
      },
    };
    await assert.rejects(
      () => api.getTicket('QRD-1148'),
      (error: unknown) => error instanceof JiraTicketLookupError && error.statusCode === 504,
    );
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
    const mention = { title: 'QRD-1241 feat: guardrail rules on the skill draft', body: 'v1 only checks the first condition until QRD-1251', head: { ref: 'feature/QRD-1241-guardrails-tab' } };
    assert.strictEqual(hasCanonicalTicketReference(mention, 'QRD-1251'), false, 'a mention inside another ticket\'s pull request is not a link');
    assert.strictEqual(hasCanonicalTicketReference(mention, 'QRD-1241'), true);
    assert.strictEqual(hasCanonicalTicketReference({ title: 'QRD-1241 feat: guardrail rules', body: 'until QRD-1251' }, 'QRD-1251'), false, 'search results carry no branch');
    assert.strictEqual(hasCanonicalTicketReference({ title: 'QRD-1241 and QRD-1251: guardrails', body: '' }, 'QRD-1251'), true);
    assert.strictEqual(hasCanonicalTicketReference({ title: 'Fix utf-8 handling', body: 'Closes QRD-1251', head: { ref: 'fix/utf-8' } }, 'QRD-1251'), true);
    assert.strictEqual(hasCanonicalTicketReference({ title: 'Fix utf-8 handling', body: 'Closes QRD-1251. Same bug as qrd-1251 on mobile.' }, 'QRD-1251'), true, 'one ticket named twice is still one ticket');
    const rollup = {
      title: 'V1 Playbook: pending tickets into feat/V1-Playbook (backend)',
      body: 'Brings QRD-1345 and QRD-1346 in.\n\nQRD-1242, QRD-1255 and QRD-1363 have no PR yet.',
      head: { ref: 'release/V1-Playbook-pending' },
    };
    assert.strictEqual(hasCanonicalTicketReference(rollup, 'QRD-1255'), false, 'a release list names many tickets and belongs to none of them');
    assert.strictEqual(hasCanonicalTicketReference(rollup, 'QRD-1345'), false);
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

  const connectedCalendarStorage = (refreshToken = 'refresh-token-secret') => ({
    getSettings: async () => [
      { key: 'googleClientId', value: 'client-id.apps.googleusercontent.com' },
      { key: 'googleClientSecret', value: 'client-secret-value' },
      { key: 'googleRefreshToken', value: refreshToken },
    ],
    getCache: async () => null,
    upsertCache: async () => undefined,
  });
  const googleResponseError = (status: number, data: unknown) => Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

  await t.test('stops calling Google and explains a rejected saved sign-in', async () => {
    const service = new GoogleCalendarService(connectedCalendarStorage() as any);
    const originalPost = axios.post;
    const originalGet = axios.get;
    const originalWarn = console.warn;
    const warnings: string[] = [];
    let refreshCalls = 0;
    (axios as any).post = async () => {
      refreshCalls += 1;
      throw googleResponseError(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    };
    (axios as any).get = async () => { throw new Error('events must not be requested without an access token'); };
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await assert.rejects(
          () => service.listEvents('2026-08-29T00:00:00.000Z', '2026-08-30T00:00:00.000Z', 25),
          (error: unknown) => error instanceof CalendarUnavailableError
            && error.message === 'Google rejected the saved sign-in. Connect Google Calendar again in Settings.',
        );
      }
      assert.strictEqual(refreshCalls, 1);
      assert.strictEqual(warnings.length, 1);
      assert.match(warnings[0], /^\[Google Calendar\] token refresh rejected status=400 invalid_grant Token has been expired or revoked\.$/);
      assert.ok(!warnings[0].includes('refresh-token-secret') && !warnings[0].includes('client-secret-value'));
      assert.strictEqual(service.lastError(), 'Google rejected the saved sign-in. Connect Google Calendar again in Settings.');
    } finally {
      axios.post = originalPost;
      axios.get = originalGet;
      console.warn = originalWarn;
    }
  });

  await t.test('retries a rejected sign-in once the refresh token changes', async () => {
    let refreshToken = 'refresh-token-old';
    const storage = { ...connectedCalendarStorage(), getSettings: async () => (await connectedCalendarStorage(refreshToken).getSettings()) };
    const service = new GoogleCalendarService(storage as any);
    const originalPost = axios.post;
    const originalGet = axios.get;
    const originalWarn = console.warn;
    console.warn = () => undefined;
    (axios as any).post = async (_url: string, body: string) => {
      if (body.includes('refresh-token-old')) throw googleResponseError(400, { error: 'invalid_grant' });
      return { data: { access_token: 'access-token-new' } };
    };
    (axios as any).get = async () => ({ data: { items: [] } });

    try {
      await assert.rejects(() => service.listEvents(), CalendarUnavailableError);
      refreshToken = 'refresh-token-new';
      assert.deepStrictEqual(await service.listEvents(), []);
      assert.strictEqual(service.lastError(), null);
    } finally {
      axios.post = originalPost;
      axios.get = originalGet;
      console.warn = originalWarn;
    }
  });

  await t.test('logs Google detail once and backs off when the events request is rejected', async () => {
    const service = new GoogleCalendarService(connectedCalendarStorage() as any);
    const originalPost = axios.post;
    const originalGet = axios.get;
    const originalWarn = console.warn;
    const warnings: string[] = [];
    let eventCalls = 0;
    (axios as any).post = async () => ({ data: { access_token: 'access-token-secret' } });
    (axios as any).get = async () => {
      eventCalls += 1;
      throw googleResponseError(400, { error: { code: 400, message: 'Bad Request', status: 'INVALID_ARGUMENT' } });
    };
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await assert.rejects(
          () => service.listEvents(),
          (error: unknown) => error instanceof CalendarUnavailableError
            && error.message === 'Google rejected the calendar request. Check the Calendar ID in Settings.',
        );
      }
      assert.strictEqual(eventCalls, 1);
      assert.deepStrictEqual(warnings, ['[Google Calendar] events request failed status=400 INVALID_ARGUMENT Bad Request']);
      assert.ok(!warnings[0].includes('access-token-secret'));
    } finally {
      axios.post = originalPost;
      axios.get = originalGet;
      console.warn = originalWarn;
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

  await t.test('stores the chat agent settings, defaults them to RTK on and caveman full, and rejects invalid values', async () => {
    const writes: Array<[string, string]> = [];
    const storage = {
      getSettings: async () => [],
      hasMasterPin: async () => false,
      upsertSetting: async (key: string, value: string) => { writes.push([key, value]); },
    };
    const api = new StorageAPI(storage as any);

    const settings = await api.getPublicSettings();
    assert.deepStrictEqual([settings.chatRtk, settings.chatCaveman, settings.chatDefaultModel], ['on', 'full', null]);
    assert.strictEqual(await api.updateSettings({ chatCaveman: 'loud' }), false);
    assert.strictEqual(await api.updateSettings({ chatRtk: 'maybe' }), false);
    assert.strictEqual(await api.updateSettings({ chatDefaultMode: 'yolo' }), false);
    assert.strictEqual(await api.updateSettings({ chatDefaultModel: 'm'.repeat(101) }), false);
    assert.strictEqual(await api.updateSettings({ chatDefaultEffort: 'e'.repeat(101) }), false);
    assert.deepStrictEqual(writes, []);
    assert.strictEqual(await api.updateSettings({ chatDefaultMode: '' }), true);
    writes.length = 0;
    assert.strictEqual(await api.updateSettings({ chatCaveman: 'lite', chatRtk: 'off', chatDefaultModel: 'sonnet' }), true);
    assert.deepStrictEqual(writes, [['chatCaveman', 'lite'], ['chatRtk', 'off'], ['chatDefaultModel', 'sonnet']]);
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
