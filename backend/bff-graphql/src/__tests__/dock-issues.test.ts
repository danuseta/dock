import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildIssueBody, draftUrl, DRAFT_URL_LIMIT, issuesRepo, pagePath, resolveBuild, toDockIssue, type IssueEnvironment } from '../integrations/dock-issues';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { GitHubClient } from '../integrations/github';
import { StorageAPI } from '../datasources/StorageAPI';
import { protectedMutations, protectedQueries, resolvers } from '../resolvers';

const environment: IssueEnvironment = { build: '/assets/index-abc.js', mode: 'workspace', branch: 'feat/x', page: '/sprint', reporter: 'Ann' };
const context = { request: { headers: {}, socket: {} }, authenticated: true };

type Resolver = (...args: unknown[]) => Promise<any>;
const query = (name: string) => (resolvers.Query as unknown as Record<string, Resolver>)[name];
const mutation = (name: string) => (resolvers.Mutation as unknown as Record<string, Resolver>)[name];

const rawIssue = (number: number, extra: Record<string, unknown> = {}) => ({
  number, title: `Issue ${number}`, state: 'open', body: 'body', html_url: `https://github.com/danuseta/dock/issues/${number}`,
  comments: 2, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', user: { login: 'ann', avatar_url: 'https://a/ann.png' }, ...extra,
});

async function withGitHub<T>(token: string, run: (calls: string[]) => Promise<T>, issues: unknown[] = []): Promise<T> {
  const calls: string[] = [];
  const proto = { storage: StorageAPI.prototype, client: GitHubClient.prototype } as Record<string, any>;
  const saved = {
    hasMasterPin: proto.storage.hasMasterPin,
    getSettings: proto.storage.getSettings,
    listIssues: proto.client.listIssues,
    validateCredentials: proto.client.validateCredentials,
    createIssue: proto.client.createIssue,
  };
  proto.storage.hasMasterPin = async () => false;
  proto.storage.getSettings = async () => ({ githubToken: token });
  proto.client.listIssues = async (_repo: string, state: string, creator?: string) => {
    calls.push(`list ${state} ${creator ?? ''}`.trim());
    return (issues as Array<{ pull_request?: unknown }>).filter((item) => !item.pull_request);
  };
  proto.client.validateCredentials = async () => { calls.push('user'); return { login: 'ann' }; };
  proto.client.createIssue = async (_repo: string, title: string) => { calls.push(`create ${title}`); return { number: 9, html_url: 'https://github.com/danuseta/dock/issues/9' }; };
  try {
    return await run(calls);
  } finally {
    proto.storage.hasMasterPin = saved.hasMasterPin;
    proto.storage.getSettings = saved.getSettings;
    proto.client.listIssues = saved.listIssues;
    proto.client.validateCredentials = saved.validateCredentials;
    proto.client.createIssue = saved.createIssue;
  }
}

test('the issue body carries the form sections then the Environment block', () => {
  const body = buildIssueBody({ title: 't', happened: ' It broke ', steps: '1. open', expected: 'It works', imageLinks: ['https://x/a.png', 'https://x/a b.png', 'https://x/<b>.png', 'javascript:alert(1)', 'ftp://x/b.png', ' http://x/c.png '], page: '/sprint' }, environment);
  const headings = body.split('\n').filter((line) => line.startsWith('## '));
  assert.deepStrictEqual(headings, ['## What happened', '## Steps to reproduce', '## Expected', '## Screenshots', '## Environment']);
  assert.ok(body.includes('## What happened\n\nIt broke\n'));
  assert.ok(body.includes('![screenshot](<https://x/a.png>)') && body.includes('![screenshot](<http://x/c.png>)'));
  assert.ok(!body.includes('javascript:') && !body.includes('ftp://'), 'only http and https links are kept');
  assert.ok(body.includes('- Build: /assets/index-abc.js\n- DOCK_MODE: workspace\n- Branch: feat/x\n- Page: /sprint\n- Reported by: Ann'));
});

test('empty optional sections are left out', () => {
  const body = buildIssueBody({ title: 't', happened: 'x', steps: ' ', imageLinks: ['nope'], page: '/' }, { ...environment, build: null });
  assert.deepStrictEqual(body.split('\n').filter((line) => line.startsWith('## ')), ['## What happened', '## Environment']);
  assert.ok(body.includes('- Build: unknown'));
});

test('the prefill address carries the title and the same body', () => {
  const draft = { title: 'Broken & sad', happened: 'It broke', page: '/sprint' };
  const url = new URL(draftUrl('danuseta/dock', draft, environment));
  assert.strictEqual(`${url.origin}${url.pathname}`, 'https://github.com/danuseta/dock/issues/new');
  assert.strictEqual(url.searchParams.get('title'), 'Broken & sad');
  assert.strictEqual(url.searchParams.get('body'), buildIssueBody(draft, environment));
});

test('a long report is trimmed until the address fits and says so', () => {
  const long = 'é'.repeat(6000);
  const url = draftUrl('danuseta/dock', { title: 't', happened: long, steps: long, page: '/' }, environment);
  assert.ok(url.length <= DRAFT_URL_LIMIT, String(url.length));
  const body = new URL(url).searchParams.get('body') ?? '';
  assert.ok(body.includes('(trimmed to fit the GitHub link)'));
  assert.ok(body.includes('## Environment'), 'the Environment block survives');
  const short = draftUrl('danuseta/dock', { title: 't', happened: 'short', page: '/' }, environment);
  assert.ok(!decodeURIComponent(short).includes('trimmed'));
});

test('the repository comes from DOCK_ISSUES_REPO and defaults to danuseta/dock', () => {
  const previous = process.env.DOCK_ISSUES_REPO;
  try {
    delete process.env.DOCK_ISSUES_REPO;
    assert.strictEqual(issuesRepo(), 'danuseta/dock');
    process.env.DOCK_ISSUES_REPO = ' acme/tool ';
    assert.strictEqual(issuesRepo(), 'acme/tool');
  } finally {
    if (previous === undefined) delete process.env.DOCK_ISSUES_REPO; else process.env.DOCK_ISSUES_REPO = previous;
  }
});

test('an issue maps to the DOCK shape', () => {
  assert.deepStrictEqual(toDockIssue(rawIssue(3)), {
    number: 3, title: 'Issue 3', state: 'open', author: { login: 'ann', avatarUrl: 'https://a/ann.png' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', comments: 2, url: 'https://github.com/danuseta/dock/issues/3', body: 'body',
  });
});

test('the issue fields sit behind the PIN and nothing closes or edits an issue', () => {
  for (const name of ['dockIssues', 'dockIssue', 'dockIssueDraftUrl']) assert.ok((protectedQueries as readonly string[]).includes(name), name);
  assert.ok((protectedMutations as readonly string[]).includes('reportDockIssue'));
  assert.deepStrictEqual(Object.keys(resolvers.Mutation).filter((name) => /issue/i.test(name)), ['reportDockIssue']);
});

test('the list drops pull requests and reads each state', async () => {
  const items = [rawIssue(1), rawIssue(2, { pull_request: {} })];
  await withGitHub('tok', async (calls) => {
    const open = await query('dockIssues')({}, { filter: 'OPEN' }, context);
    assert.deepStrictEqual([open.tokenMissing, open.viewer, open.issues.map((issue: { number: number }) => issue.number)], [false, null, [1]]);
    await query('dockIssues')({}, { filter: 'CLOSED' }, context);
    assert.deepStrictEqual(calls, ['list open', 'list closed']);
  }, items);
});

test('Mine lists open and closed issues of the token user', async () => {
  await withGitHub('tok', async (calls) => {
    const mine = await query('dockIssues')({}, { filter: 'MINE' }, context);
    assert.strictEqual(mine.viewer, 'ann');
    assert.deepStrictEqual(calls, ['user', 'list all ann']);
  }, [rawIssue(1), rawIssue(4, { state: 'closed' })]);
});

test('without a token the queries answer tokenMissing and never call GitHub', async () => {
  await withGitHub('', async (calls) => {
    assert.deepStrictEqual(await query('dockIssues')({}, { filter: 'OPEN' }, context), { tokenMissing: true, viewer: null, issues: [] });
    assert.strictEqual(await query('dockIssue')({}, { number: 1 }, context), null);
    assert.deepStrictEqual(calls, []);
  });
});

test('reporting without a token fails and the draft address still builds', async () => {
  const draft = { title: 'T', happened: 'H', page: '/x' };
  await withGitHub('', async (calls) => {
    await assert.rejects(mutation('reportDockIssue')({}, draft, context), /GitHub token is not configured in Settings/);
    assert.deepStrictEqual(calls, []);
    const url = await query('dockIssueDraftUrl')({}, draft, context);
    assert.ok(url.startsWith('https://github.com/danuseta/dock/issues/new?title=T&body='));
  });
});

test('reporting posts the built body and returns the number and link', async () => {
  await withGitHub('tok', async (calls) => {
    const posted = await mutation('reportDockIssue')({}, { title: ' T ', happened: 'H', page: '/x' }, context);
    assert.deepStrictEqual(posted, { number: 9, url: 'https://github.com/danuseta/dock/issues/9' });
    assert.deepStrictEqual(calls, ['create T']);
    await assert.rejects(mutation('reportDockIssue')({}, { title: ' ', happened: 'H', page: '/x' }, context), /required/);
  });
});

test('a GitHub refusal reaches the caller as its message', async () => {
  const original = GitHubAPI.prototype.createDockIssue;
  const saved = StorageAPI.prototype.hasMasterPin;
  GitHubAPI.prototype.createDockIssue = async () => { throw Object.assign(new Error('Request failed'), { response: { data: { message: 'Resource not accessible' } } }); };
  StorageAPI.prototype.hasMasterPin = async () => false;
  try {
    await assert.rejects(mutation('reportDockIssue')({}, { title: 'T', happened: 'H', page: '/x' }, context), /Resource not accessible/);
  } finally {
    GitHubAPI.prototype.createDockIssue = original;
    StorageAPI.prototype.hasMasterPin = saved;
  }
});

test('trimming cuts by code points so an emoji never breaks the address', () => {
  const url = draftUrl('danuseta/dock', { title: 't', happened: '\u{1F600}'.repeat(566), page: '/' }, environment);
  assert.ok(url.length <= DRAFT_URL_LIMIT, String(url.length));
  assert.ok((new URL(url).searchParams.get('body') ?? '').includes('(trimmed to fit the GitHub link)'));
});

test('every long part still ends in an address that fits', () => {
  const long = 'x'.repeat(9000);
  const links = Array.from({ length: 80 }, (_, index) => `https://example.com/${'a'.repeat(100)}/${index}.png`);
  for (const draft of [
    { title: 't', happened: 'h', expected: long, page: '/' },
    { title: 't', happened: 'h', imageLinks: links, page: '/' },
    { title: '\u{1F600}'.repeat(900), happened: 'h', page: '/' },
    { title: 't', happened: long, steps: long, expected: long, imageLinks: links, page: '/' },
  ]) {
    const url = draftUrl('danuseta/dock', draft, environment);
    assert.ok(url.length <= DRAFT_URL_LIMIT, String(url.length));
  }
});

test('the page of a report is a clean path', () => {
  assert.strictEqual(pagePath('/sprint'), '/sprint');
  assert.strictEqual(pagePath('sprint'), '/');
  assert.strictEqual(pagePath('/a b\n## c'), '/ab##c');
  assert.strictEqual(pagePath(`/${'p'.repeat(500)}`).length, 200);
});

test('the build is the short commit of the app, or the asset name when there is no git checkout', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dock-build-'));
  try {
    assert.strictEqual(resolveBuild(directory, '/assets/index-abc.js'), '/assets/index-abc.js');
    assert.strictEqual(resolveBuild(directory, null), null);
    assert.match(resolveBuild(path.resolve(__dirname, '../../../..'), '/assets/index-abc.js') ?? '', /^[0-9a-f]{7,}$|^\/assets\/index-abc\.js$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Mine without a login answers an empty list, and GitHub errors reach the caller cleanly', async () => {
  await withGitHub('tok', async (calls) => {
    GitHubClient.prototype.validateCredentials = (async () => ({})) as never;
    const mine = await query('dockIssues')({}, { filter: 'MINE' }, context);
    assert.deepStrictEqual([mine.viewer, mine.issues], [null, []]);
    assert.deepStrictEqual(calls, []);
    GitHubClient.prototype.listIssues = (async () => { throw Object.assign(new Error('Request failed'), { response: { status: 403, data: { message: 'Bad credentials' } } }); }) as never;
    await assert.rejects(query('dockIssues')({}, { filter: 'OPEN' }, context), /Bad credentials/);
  });
});

test('an issue GitHub does not know is null, any other failure is a clean error', async () => {
  await withGitHub('tok', async () => {
    const failWith = (status: number, message: string) => { GitHubClient.prototype.getIssue = (async () => { throw Object.assign(new Error('Request failed'), { response: { status, data: { message } } }); }) as never; };
    const original = GitHubClient.prototype.getIssue;
    try {
      failWith(404, 'Not Found');
      assert.strictEqual(await query('dockIssue')({}, { number: 99 }, context), null);
      failWith(500, 'Server error');
      await assert.rejects(query('dockIssue')({}, { number: 99 }, context), /Server error/);
    } finally {
      GitHubClient.prototype.getIssue = original;
    }
  });
});
