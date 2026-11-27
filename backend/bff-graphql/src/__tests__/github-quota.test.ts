import assert from 'node:assert';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GitHubClient, GitHubService, githubQuotaOf } from '../integrations/github';
import { GitHubBudget, GitHubRateLimitError, LOW_REMAINING } from '../integrations/github-budget';

const REPOS = ['org/r1', 'org/r2', 'org/r3', 'org/r4', 'org/r5', 'org/r6'];
const START = 1_800_000_000_000;

interface Pull { number: number; title: string; state: string; updated_at: string; repo: string }

function fakeGitHub() {
  const pulls: Pull[] = [];
  const counts = { list: 0, notModified: 0, search: 0, status: 0, commits: 0, files: 0, other: 0, total: 0 };
  const flags = { exhaustedUntil: 0, remaining: 4000, failList: '' as string, searchItems: [] as any[] };
  let inFlight = 0;
  let maxInFlight = 0;
  const etagOf = (repo: string) => `"${createHash('sha1').update(JSON.stringify(pulls.filter((pr) => pr.repo === repo))).digest('hex')}"`;
  const send = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(status === 304 ? undefined : JSON.stringify(body));
  };
  const handle = (request: IncomingMessage, response: ServerResponse, base: string) => {
    const url = new URL(request.url || '/', 'http://local');
    const path = url.pathname.replace(/^\/github/, '');
    counts.total += 1;
    if (flags.exhaustedUntil) {
      send(response, 403, { message: 'API rate limit exceeded for user ID 1.' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(flags.exhaustedUntil / 1000) });
      return;
    }
    const rate = { 'x-ratelimit-remaining': String(flags.remaining), 'x-ratelimit-reset': String(Math.floor(START / 1000) + 7200) };
    const list = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(path);
    if (list) {
      counts.list += 1;
      const repo = list[1];
      if (flags.failList === repo) { send(response, 502, { message: 'bad gateway' }, rate); return; }
      const etag = etagOf(repo);
      if (request.headers['if-none-match'] === etag) { counts.notModified += 1; send(response, 304, null, { ...rate, etag }); return; }
      send(response, 200, pulls.filter((pr) => pr.repo === repo).map((pr) => ({
        id: pr.number, number: pr.number, title: pr.title, body: '', state: pr.state, html_url: `https://github.com/${pr.repo}/pull/${pr.number}`,
        updated_at: pr.updated_at, created_at: pr.updated_at, head: { ref: `feat/${pr.title.split(' ')[0]}` }, base: { ref: 'main' },
      })), { ...rate, etag });
      return;
    }
    if (path === '/search/issues') {
      counts.search += 1;
      send(response, 200, { items: flags.searchItems.map((item) => ({ ...item, repository_url: `${base}/repos/${item.repo}` })) }, rate);
      return;
    }
    const detail = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)(\/commits|\/files)?$/.exec(path);
    if (detail) {
      if (detail[2] === '/commits') { counts.commits += 1; send(response, 200, [], rate); return; }
      if (detail[2] === '/files') { counts.files += 1; send(response, 200, [], rate); return; }
      counts.status += 1;
      send(response, 200, { merged: false, draft: false, mergeable: true, mergeable_state: 'clean', head: { sha: 'abc', ref: 'feat' }, base: { ref: 'main' } }, rate);
      return;
    }
    counts.other += 1;
    send(response, 200, {}, rate);
  };
  const server = createServer((request, response) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    response.on('finish', () => { inFlight -= 1; });
    setTimeout(() => handle(request, response, `http://127.0.0.1:${(server.address() as AddressInfo).port}/github`), 5);
  });
  return {
    pulls, counts, flags, server,
    maxInFlight: () => maxInFlight,
    resetMax: () => { maxInFlight = 0; },
    detailRequests: () => counts.status + counts.commits + counts.files,
  };
}

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const github = fakeGitHub();
  await new Promise<void>((resolve) => github.server.listen(0, '127.0.0.1', resolve));
  const previousMock = process.env.DOCK_MOCK_URL;
  process.env.DOCK_MOCK_URL = `http://127.0.0.1:${(github.server.address() as AddressInfo).port}`;
  t.after(() => new Promise<void>((resolve) => {
    if (previousMock === undefined) delete process.env.DOCK_MOCK_URL; else process.env.DOCK_MOCK_URL = previousMock;
    github.server.close(() => resolve());
  }));
  const clock = { now: START };
  const now = () => clock.now;
  const cache = new Map<string, any>();
  const storage = {
    getCache: async (_: string, key: string) => (cache.has(key) ? JSON.parse(JSON.stringify(cache.get(key))) : null),
    upsertCache: async (_: string, key: string, value: unknown) => { cache.set(key, JSON.parse(JSON.stringify(value))); },
  };
  const budget = new GitHubBudget(now);
  const service = new GitHubService(storage as never, { now, budget });
  return { github, clock, cache, budget, service };
}

const quiet = () => {
  const log = console.error;
  console.error = () => undefined;
  return () => { console.error = log; };
};

const ticketPulls = (github: ReturnType<typeof fakeGitHub>, tickets: number) => {
  for (let index = 1; index <= tickets; index += 1) {
    github.pulls.push({ number: index, title: `QRD-${index} work`, state: 'open', updated_at: '2026-11-25T01:00:00Z', repo: REPOS[index % REPOS.length] });
  }
};

const readAll = (service: GitHubService, tickets: number, options = {}) => Promise.all(
  Array.from({ length: tickets }, (_, index) => service.searchPRs('pat', REPOS, `QRD-${index + 1}`, options)),
);

test('20 tickets across 6 repositories share 6 list requests and a read inside the TTL asks GitHub nothing', async (t) => {
  const { github, clock, service } = await setup(t);
  ticketPulls(github, 20);

  const first = await readAll(service, 20);
  assert.ok(first.every((prs) => prs.length === 1), 'every ticket finds its pull request in the shared lists');
  assert.strictEqual(github.counts.list, 6, 'one list request per repository, not one per ticket');
  assert.strictEqual(github.counts.search, 0, 'no search when the lists hold the ticket');
  assert.strictEqual(github.detailRequests(), 60, 'status, commits and files once per pull request');
  assert.ok(github.maxInFlight() <= 4, `background requests go out at most 4 at a time (saw ${github.maxInFlight()})`);
  const total = github.counts.total;

  await readAll(service, 20);
  assert.strictEqual(github.counts.total, total, 'a second read inside the TTL makes no request');

  clock.now += 46_000;
  await readAll(service, 20);
  assert.strictEqual(github.counts.total, total, 'nothing is refetched at 45 seconds');

  clock.now += 3 * 60_000;
  await readAll(service, 20);
  assert.strictEqual(github.counts.list, 12, 'past the 3 minute TTL of an open pull request the lists are asked again');
  assert.strictEqual(github.counts.notModified, 6, 'unchanged lists answer 304 and the stored list is reused');
  assert.strictEqual(github.detailRequests(), 60, 'unchanged updated_at means no detail request');
});

test('a pull request whose updated_at moved is the only one asked for its detail again', async (t) => {
  const { github, clock, service } = await setup(t);
  ticketPulls(github, 6);
  await readAll(service, 6);
  assert.strictEqual(github.detailRequests(), 18);

  github.pulls[0].updated_at = '2026-11-25T02:00:00Z';
  clock.now += 3 * 60_000 + 1000;
  const prs = await readAll(service, 6);
  assert.strictEqual(github.counts.notModified, 5, 'the five untouched repositories answer 304');
  assert.strictEqual(github.detailRequests(), 21, 'only the changed pull request is asked again: status, commits, files');
  assert.strictEqual(prs[0][0].updated_at, '2026-11-25T02:00:00Z');
});

test('a ticket closed everywhere is kept 30 minutes', async (t) => {
  const { github, clock, service } = await setup(t);
  github.pulls.push({ number: 7, title: 'QRD-7 done', state: 'closed', updated_at: '2026-11-25T01:00:00Z', repo: 'org/r1' });
  await service.searchPRs('pat', REPOS, 'QRD-7');
  const total = github.counts.total;
  clock.now += 29 * 60_000;
  await service.searchPRs('pat', REPOS, 'QRD-7');
  assert.strictEqual(github.counts.total, total);
  clock.now += 2 * 60_000;
  await service.searchPRs('pat', REPOS, 'QRD-7');
  assert.strictEqual(github.counts.list, 12, 'asked again once the 30 minutes are over');
});

test('the search fallback runs only for a ticket missing from the lists and is not repeated inside its TTL', async (t) => {
  const { github, clock, service } = await setup(t);
  ticketPulls(github, 2);
  github.flags.searchItems = [{ id: 900, number: 900, title: 'QRD-99 old work', body: '', state: 'closed', html_url: 'https://github.com/org/r1/pull/900', updated_at: '2026-01-01T00:00:00Z', repo: 'org/r1' }];
  const restore = quiet();
  try {
    await service.searchPRs('pat', REPOS, 'QRD-1');
    assert.strictEqual(github.counts.search, 0, 'a ticket found in the lists never searches');

    const old = await service.searchPRs('pat', REPOS, 'QRD-99');
    assert.strictEqual(github.counts.search, 1);
    assert.strictEqual(old[0].number, 900, 'a pull request older than the newest 50 is found by the search');

    github.flags.failList = 'org/r2';
    clock.now += 2 * 60_000 + 1000;
    await service.searchPRs('pat', REPOS, 'QRD-98');
    assert.strictEqual(github.counts.search, 2);
    clock.now += 5 * 60_000 + 1000;
    github.flags.failList = '';
    await service.searchPRs('pat', REPOS, 'QRD-98');
    assert.strictEqual(github.counts.search, 2, 'a ticket asked again after a failed list keeps its search answer');
  } finally { restore(); }
});

test('a used-up quota stops every request until the reset, keeps the cache and resumes a few at a time', async (t) => {
  const { github, clock, cache, budget, service } = await setup(t);
  ticketPulls(github, 12);
  const before = await readAll(service, 12);
  assert.ok(before.every((prs) => prs.length === 1));

  const resetAt = START + 30 * 60_000;
  github.flags.exhaustedUntil = resetAt;
  clock.now += 3 * 60_000 + 1000;
  const restore = quiet();
  try {
    const during = await readAll(service, 12);
    assert.deepStrictEqual(during, before, 'callers keep the cached pull requests');
    const sent = github.counts.total;
    const entry = [...cache.entries()].find(([key]) => key.startsWith('prs_v5_') && key.endsWith('_QRD-1'))?.[1];
    assert.strictEqual(entry.expiresAt, resetAt, 'the cached answer now lasts until the reset, not 300 seconds');
    assert.deepStrictEqual(githubQuotaOf('pat', budget), { limited: true, remaining: 0, resetAt: new Date(resetAt).toISOString() });

    await assert.rejects(new GitHubClient('pat', { budget, priority: true }).getRepo('org', 'r1'), GitHubRateLimitError);
    clock.now += 10 * 60_000;
    await readAll(service, 12);
    await readAll(service, 12, { fresh: true });
    assert.strictEqual(github.counts.total, sent, 'nothing reaches GitHub before the reset, priority work included');

    github.flags.exhaustedUntil = 0;
    github.resetMax();
    clock.now = resetAt + 1000;
    await readAll(service, 12);
    assert.ok(github.counts.total > sent, 'requests resume after the reset');
    assert.ok(github.maxInFlight() <= 4, `background refreshes go out at most 4 at a time (saw ${github.maxInFlight()})`);
    assert.strictEqual(githubQuotaOf('pat', budget).limited, false);
  } finally { restore(); }
});

test(`below ${LOW_REMAINING} requests left background refreshes wait and priority work goes through`, async (t) => {
  const { github, clock, budget, service } = await setup(t);
  ticketPulls(github, 3);
  const before = await readAll(service, 3);
  assert.ok(before.every((prs) => prs.length === 1));
  github.flags.remaining = 300;
  await new GitHubClient('pat', { budget, priority: true }).getRepo('org', 'r1');
  assert.strictEqual(githubQuotaOf('pat', budget).remaining, 300);
  const sent = github.counts.total;

  clock.now += 3 * 60_000 + 1000;
  const restore = quiet();
  try {
    assert.deepStrictEqual(await readAll(service, 3), before, 'the background refresh is deferred and the cache served');
    assert.deepStrictEqual(await service.searchPRs('pat', REPOS, 'QRD-1', { staleWhileRevalidate: true }), before[0]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(github.counts.total, sent, 'no background request is sent');

    const fresh = await service.searchPRs('pat', REPOS, 'QRD-1', { fresh: true });
    assert.strictEqual(fresh.length, 1);
    assert.ok(github.counts.total > sent, 'a fresh lookup is priority work and reaches GitHub');
    const afterFresh = github.counts.total;
    await new GitHubClient('pat', { budget, priority: true }).getPRStatus('org', 'r1', 1);
    assert.strictEqual(github.counts.total, afterFresh + 1, 'a priority client call proceeds');
    await assert.rejects(new GitHubClient('pat', { budget }).getPRStatus('org', 'r1', 1), (error: unknown) => error instanceof GitHubRateLimitError && error.reason === 'low');
    assert.strictEqual(github.counts.total, afterFresh + 1, 'a background client call is rejected without a network call');
  } finally { restore(); }
});

test('the budget reads remaining and reset from a response and blocks only on a rate limit answer', () => {
  const clock = { now: START };
  const budget = new GitHubBudget(() => clock.now);
  assert.deepStrictEqual(budget.state('k'), { limited: false, remaining: null, resetAt: null });
  budget.record('k', 200, { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(START / 1000 + 3600) });
  assert.deepStrictEqual(budget.state('k'), { limited: false, remaining: 4999, resetAt: new Date(START + 3_600_000).toISOString() });
  budget.record('k', 403, { 'x-ratelimit-remaining': '12' }, 'Resource not accessible by integration');
  assert.strictEqual(budget.state('k').limited, false, 'a permission 403 is not a rate limit');
  budget.record('k', 403, { 'retry-after': '60' }, 'You have exceeded a secondary rate limit');
  assert.deepStrictEqual(budget.state('k'), { limited: true, remaining: 0, resetAt: new Date(START + 60_000).toISOString() });
  clock.now = START + 3_600_001;
  assert.deepStrictEqual(budget.state('k'), { limited: false, remaining: null, resetAt: null }, 'a past reset reads as unknown');
});

test('a search answer counts against the search quota, so background requests after it still go out', async () => {
  const budget = new GitHubBudget(() => START);
  budget.record('k', 200, { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(START / 1000 + 3600) });
  budget.record('k', 200, { 'x-ratelimit-resource': 'search', 'x-ratelimit-remaining': '29', 'x-ratelimit-reset': String(START / 1000 + 60) });
  assert.strictEqual(budget.state('k').remaining, 4990);
  const release = await budget.acquire('k', false);
  release();
  budget.record('k', 403, { 'x-ratelimit-resource': 'search', 'x-ratelimit-remaining': '0' }, 'API rate limit exceeded');
  assert.strictEqual(budget.state('k').limited, false, 'a used-up search quota does not stop core requests');
});
