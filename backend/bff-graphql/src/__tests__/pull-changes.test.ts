import assert from 'node:assert';
import test from 'node:test';
import { ChangesInputError, PullChangesService, failureOf, orderPulls, toFile, trimFiles, type ChangesRun, type GitHubReader } from '../integrations/pull-changes';

const BE = 'https://github.com/acme/ms-admin-cf-backend/pull/12';
const FE = 'https://github.com/acme/ms-client-dashboard-frontend/pull/34';
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

const rawPull = (number: number, sha = SHA) => ({ number, title: `PR ${number}`, state: 'open', draft: false, merged_at: null, user: { login: 'danu' }, head: { ref: 'feat/x', sha }, base: { ref: 'main' }, additions: 3, deletions: 1, changed_files: 2 });
const rawFile = (name: string, patch: string | null = '@@ -1 +1 @@\n-a\n+b') => ({ filename: name, status: 'modified', additions: 1, deletions: 1, ...(patch === null ? {} : { patch }) });
const httpError = (status: number, headers: Record<string, string> = {}) => Object.assign(new Error(`status ${status}`), { response: { status, headers } });

const run = (extra: Partial<ChangesRun>): ChangesRun => ({
  key: 'QRD-1189', kind: 'build', title: 'Inbox export', prBe: null, prFe: null, reviewTicket: null, reviewPrs: [], verdict: null, rounds: null, findings: [], updatedAt: '2026-10-20T00:00:00.000Z', ...extra,
});

function world(options: { runs?: ChangesRun[]; search?: string[]; token?: boolean; files?: Record<string, any[]>; pull?: (owner: string, repo: string, n: number) => any; raw?: string } = {}) {
  const calls: string[] = [];
  const cache = new Map<string, unknown>();
  let now = new Date('2026-10-27T03:00:00.000Z');
  const github: GitHubReader = {
    pull: async (owner, repo, n) => { calls.push(`pull ${repo}#${n}`); return options.pull ? options.pull(owner, repo, n) : rawPull(n); },
    files: async (_owner, repo, n, page) => { calls.push(`files ${repo}#${n} p${page}`); return options.files?.[`${repo}#${n}`]?.slice((page - 1) * 100, page * 100) ?? [rawFile('src/a.ts')]; },
    commitDate: async () => { calls.push('commit'); return '2026-10-26T10:00:00Z'; },
    raw: async (_owner, _repo, path, ref) => { calls.push(`raw ${path}@${ref.slice(0, 1)}`); return options.raw ?? Array.from({ length: 900 }, (_, i) => `line ${i + 1}`).join('\n'); },
    repo: async () => { calls.push('repo'); return {}; },
  };
  const service = new PullChangesService({
    github: async () => (options.token === false ? null : github),
    search: async () => options.search ?? [FE],
    runs: async () => options.runs ?? [run({ prBe: BE })],
    cacheGet: async (key) => cache.get(key) ?? null,
    cacheSet: async (key, value) => { cache.set(key, value); },
    now: () => now,
  });
  return { service, calls, cache, later: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

test('a file GitHub sends without a patch is too large; a rename without changes is not', () => {
  assert.strictEqual(toFile(rawFile('logo.png', null)).tooLarge, true);
  assert.strictEqual(toFile({ filename: 'b.ts', previous_filename: 'a.ts', status: 'renamed', additions: 0, deletions: 0 }).tooLarge, false);
  assert.deepStrictEqual(toFile(rawFile('a.ts')), { path: 'a.ts', previousPath: null, status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b', tooLarge: false });
});

test('the pull requests of a ticket are deduplicated, backend first, and two in one repository get their number', () => {
  const pulls = orderPulls([FE, `${BE}/`, BE, 'https://github.com/acme/docs/pull/2', 'not a link', 'https://github.com/acme/docs/pull/1'], new Set(), new Set());
  assert.deepStrictEqual(pulls.map((pull) => pull.tab), ['ms-admin-cf-backend', 'ms-client-dashboard-frontend', 'docs#1', 'docs#2']);
});

test('the size guard drops patches past 300 files or 4 MB and says the list is partial', () => {
  const files = Array.from({ length: 302 }, (_, i) => toFile(rawFile(`f${i}.ts`)));
  const small = trimFiles(files);
  assert.deepStrictEqual([small.partial, small.files.filter((file) => file.patch === null).length], [true, 2]);
  const big = trimFiles([toFile(rawFile('a.ts', 'x'.repeat(4 * 1024 * 1024))), toFile(rawFile('b.ts'))]);
  assert.deepStrictEqual(big.files.map((file) => file.patch === null), [false, true]);
  assert.strictEqual(trimFiles(files.slice(0, 3)).partial, false);
});

test('a rate limit, a refusal and a missing pull request read as such', () => {
  assert.deepStrictEqual(failureOf(httpError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793088000' })), { code: 'RATE_LIMITED', retryAt: new Date(1793088000 * 1000).toISOString() });
  assert.strictEqual(failureOf(httpError(403)).code, 'NO_ACCESS');
  assert.strictEqual(failureOf(httpError(404)).code, 'NOT_FOUND');
  assert.strictEqual(failureOf(new Error('socket hang up')).code, 'UNAVAILABLE');
});

test('the tabs union search, the review run and the build run; only the open tab has files', async () => {
  const { service, calls } = world({ runs: [run({ prBe: BE }), run({ key: 'QRD-2000', kind: 'review', reviewTicket: 'QRD-1189', reviewPrs: ['https://github.com/acme/docs/pull/9'] })] });
  const changes = await service.changes('qrd-1189');
  assert.deepStrictEqual(changes.pulls.map((pull) => [pull.tab, pull.files === null]), [['ms-admin-cf-backend', false], ['ms-client-dashboard-frontend', true], ['docs', true]]);
  assert.strictEqual(calls.filter((call) => call.startsWith('files')).length, 1, 'one diff for the open tab only');
  assert.deepStrictEqual([changes.title, changes.pulls[0].headDate, changes.pulls[0].state], ['Inbox export', '2026-10-26T10:00:00Z', 'open']);
  const frontend = await service.changes('QRD-1189', 'ms-client-dashboard-frontend');
  assert.ok(frontend.pulls[1].files);
});

test('the files of a head are read once; a new head reads them again; the header is asked again after a minute', async () => {
  let sha = SHA;
  const { service, calls, later } = world({ search: [], pull: (_o, _r, n) => rawPull(n, sha) });
  await service.changes('QRD-1189');
  await service.changes('QRD-1189');
  assert.deepStrictEqual(calls.filter((call) => call.startsWith('pull')).length, 1, 'the header is fresh for 60 s');
  later(61_000);
  await service.changes('QRD-1189');
  assert.strictEqual(calls.filter((call) => call.startsWith('pull')).length, 2);
  assert.strictEqual(calls.filter((call) => call.startsWith('files')).length, 1, 'the same head is not fetched again');
  sha = SHA2;
  later(61_000);
  await service.changes('QRD-1189');
  assert.strictEqual(calls.filter((call) => call.startsWith('files')).length, 2, 'a new head is');
});

test('pages are joined and stop at GitHub limit of 3000 files', async () => {
  const many = Array.from({ length: 3100 }, (_, i) => rawFile(`f${i}.ts`));
  const { service, calls } = world({ search: [], files: { 'ms-admin-cf-backend#12': many } });
  const changes = await service.changes('QRD-1189');
  assert.strictEqual(changes.pulls[0].files?.length, 3000);
  assert.strictEqual(calls.filter((call) => call.startsWith('files')).length, 30);
  const two = world({ search: [], files: { 'ms-admin-cf-backend#12': many.slice(0, 150) } });
  assert.strictEqual((await two.service.changes('QRD-1189')).pulls[0].files?.length, 150);
});

test('a rate limit serves what was kept as stale; with nothing kept it says rate limited', async () => {
  let limited = false;
  const { service, later } = world({ search: [], pull: (_o, _r, n) => { if (limited) throw httpError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793088000' }); return rawPull(n); } });
  await service.changes('QRD-1189');
  limited = true;
  later(61_000);
  const kept = (await service.changes('QRD-1189')).pulls[0];
  assert.deepStrictEqual([kept.stale, kept.error, kept.files?.length, Boolean(kept.retryAt)], [true, null, 1, true]);
  const fresh = world({ search: [], pull: () => { throw httpError(429); } });
  assert.strictEqual((await fresh.service.changes('QRD-1189')).pulls[0].error, 'RATE_LIMITED');
});

test('a 404 is no access when the repository cannot be read either', async () => {
  const { service } = world({ search: [], pull: () => { throw httpError(404); } });
  assert.strictEqual((await service.changes('QRD-1189')).pulls[0].error, 'NOT_FOUND', 'the repository answers, so the pull request is missing');
  const service2 = new PullChangesService({
    github: async () => ({ pull: async () => { throw httpError(404); }, files: async () => [], commitDate: async () => null, raw: async () => '', repo: async () => { throw httpError(404); } }),
    search: async () => [], runs: async () => [run({ prBe: BE })], cacheGet: async () => null, cacheSet: async () => undefined, now: () => new Date(),
  });
  assert.strictEqual((await service2.changes('QRD-1189')).pulls[0].error, 'NO_ACCESS');
});

test('without a token the page says GitHub is not connected and still shows the review', async () => {
  const finding = { at: '2026-10-26T09:00:00.000Z', severity: 'blocker' as const, text: 'src/a.ts:3 null check', resolvedAt: null, resolvedWhy: null };
  const { service } = world({ token: false, runs: [run({ kind: 'review', verdict: 'request-change', rounds: { used: 2, max: 3 }, findings: [finding] })] });
  const changes = await service.changes('QRD-1189');
  assert.deepStrictEqual([changes.error, changes.pulls.length, changes.review?.roundsUsed, changes.review?.findings.length], ['GITHUB_NOT_CONNECTED', 0, 2, 1]);
});

test('the review is the newest review run of the ticket, dismissed or not; none means null', async () => {
  const older = run({ key: 'QRD-1189', kind: 'review', verdict: 'request-change', updatedAt: '2026-10-20T00:00:00.000Z' });
  const newer = run({ key: 'QRD-1190', kind: 'review', reviewTicket: 'QRD-1189', verdict: 'approve', updatedAt: '2026-10-25T00:00:00.000Z' });
  const other = run({ key: 'QRD-7', kind: 'review', verdict: 'approve', updatedAt: '2026-10-26T00:00:00.000Z' });
  assert.strictEqual((await world({ runs: [older, newer, other] }).service.changes('QRD-1189')).review?.runKey, 'QRD-1190');
  assert.strictEqual((await world({ runs: [run({})] }).service.changes('QRD-1189')).review, null);
});

test('a patch left out by the size guard loads on its own; a link the ticket does not list is refused', async () => {
  const { service } = world({ search: [] });
  assert.strictEqual((await service.filePatch('QRD-1189', BE, 'src/a.ts'))?.patch, '@@ -1 +1 @@\n-a\n+b');
  await assert.rejects(service.filePatch('QRD-1189', 'https://github.com/evil/repo/pull/1', 'src/a.ts'), ChangesInputError);
  await assert.rejects(service.changes('not a key'), ChangesInputError);
});

test('Expand reads only the range, at most 500 lines, of a commit', async () => {
  const { service, calls } = world({ search: [] });
  assert.deepStrictEqual(await service.fileLines('QRD-1189', BE, 'src/a.ts', SHA, 10, 12), ['line 10', 'line 11', 'line 12']);
  await service.fileLines('QRD-1189', BE, 'src/a.ts', SHA, 20, 21);
  assert.strictEqual(calls.filter((call) => call.startsWith('raw')).length, 1, 'the file at a commit is kept');
  await assert.rejects(service.fileLines('QRD-1189', BE, 'src/a.ts', SHA, 1, 501), /At most 500/);
  await assert.rejects(service.fileLines('QRD-1189', BE, 'src/a.ts', 'main', 1, 2), /commit sha/);
  await assert.rejects(service.fileLines('QRD-1189', BE, 'src/a.ts', SHA, 5, 4), /line range/);
});
