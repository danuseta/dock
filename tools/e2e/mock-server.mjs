#!/usr/bin/env node
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const DISCORD_EPOCH = 1420070400000n;
const GUILD = '100000000000000001';
const PR_FORUM = '100000000000000010';
const BUG_FORUM = '100000000000000011';
const WEBHOOK_ID = '900000000000000001';
const WEBHOOK_TOKEN = 'e2e-webhook-token';
const BOT = { id: '900000000000000099', username: 'dock-bot', global_name: 'DOCK Bot', bot: true };
const OWNER = { discordId: '111111111111111111', name: 'Danu', jira: 'acc-danu', github: 'danu-dev', email: 'danu@e2e.test' };
const TEAMMATE = { discordId: '222222222222222222', name: 'Rizky', jira: 'acc-rizky', github: 'rizky-dev', email: 'rizky@e2e.test' };
const STATUSES = ['To Do', 'In Progress', 'PR Review', 'UAT MERGED', 'UAT CHECK', 'Done'];
const DAY = 24 * 3600 * 1000;

const adf = (...lines) => ({ type: 'doc', version: 1, content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
const adfList = (items) => ({ type: 'doc', version: 1, content: [{ type: 'bulletList', content: items.map((text) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) }] });
const iso = (ms) => new Date(ms).toISOString();
const linkType = (id, name, inward, outward) => ({ id, name, inward, outward });
const TEST_LINK_TYPE = linkType('10009', 'Test', 'is tested by', 'tests');
const sha = (seed) => createHash('sha1').update(String(seed)).digest('hex');

let counter = 0;
const snowflake = (at = Date.now()) => String(((BigInt(Math.floor(at)) - DISCORD_EPOCH) << 22n) + BigInt((counter += 1) & 0x3fffff));

function jiraUser(user) {
  return { accountId: user.jira, displayName: user.name, emailAddress: user.email, active: true };
}

function initialState(now = Date.now()) {
  const sprint = { id: 100, name: 'QRD Sprint 30', state: 'active', startDate: iso(now - 2 * DAY), endDate: iso(now + 12 * DAY), originBoardId: 1 };
  const future = { id: 101, name: 'QRD Sprint 31', state: 'future', originBoardId: 1 };
  const issue = (key, summary, type, assignee, sp, ac, extra = {}) => ({
    id: String(10000 + Number(key.split('-')[1])),
    key,
    fields: {
      summary,
      issuetype: { name: type },
      status: { name: 'To Do' },
      assignee: assignee ? jiraUser(assignee) : null,
      reporter: jiraUser(OWNER),
      priority: { name: 'Medium' },
      project: { key: 'QRD', name: 'Qonflo' },
      labels: [],
      created: iso(now - 5 * DAY),
      updated: iso(now - DAY),
      parent: type === 'Epic' ? undefined : { key: 'QRD-9000', fields: { summary: 'E2E checkout epic' } },
      description: adf(`${summary}.`),
      customfield_10332: ac ? adfList(ac) : null,
      customfield_10016: sp,
      customfield_10020: type === 'Epic' ? null : [sprint],
      issuelinks: [],
      ...extra,
    },
  });
  const issues = [
    issue('QRD-9000', 'E2E checkout epic', 'Epic', OWNER, null, null),
    issue('QRD-9001', 'Fix checkout button label overflow on mobile', 'Bug', OWNER, 1, ['The checkout button label fits on one line at 360px width']),
    issue('QRD-9002', 'Add order notes field to checkout (BE + FE)', 'Story', OWNER, 5, ['The API accepts an optional note up to 500 characters', 'The checkout form shows a notes field', 'Saved notes appear on the order detail page']),
    issue('QRD-9003', 'Show delivery estimate on cart page', 'Story', TEAMMATE, 3, ['The cart page shows the delivery estimate under the total']),
    issue('QRD-9004', 'Rename "Voucher" to "Promo code" in checkout', 'Task', OWNER, 2, ['Every checkout label reads Promo code']),
    issue('QRD-9005', 'Log payment provider timeouts', 'Task', TEAMMATE, 2, ['A payment timeout is logged with the order id']),
  ];
  issues.find((item) => item.key === 'QRD-9003').fields.status = { name: 'PR Review' };
  issues.find((item) => item.key === 'QRD-9005').fields.issuelinks = [{ type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'QRD-9002' } }];

  const splitStorage = '<p>Week split for QRD Sprint 30.</p><table><tbody>'
    + '<tr><th>Ticket</th><th>Week</th><th>Note</th></tr>'
    + '<tr><td>QRD-9001</td><td>1</td><td>quick fix</td></tr>'
    + '<tr><td>QRD-9002</td><td>1</td><td>BE first</td></tr>'
    + '<tr><td>QRD-9003</td><td>2</td><td>after the API</td></tr>'
    + '<tr><td>QRD-9004</td><td>2</td><td>after 9001</td></tr>'
    + '<tr><td>QRD-9005</td><td>2</td><td>needs 9002</td></tr>'
    + '</tbody></table>';
  const contractStorage = '<h2>Working contract QRD-9000</h2><p>Order notes are optional, plain text, at most 500 characters.</p>'
    + '<p>The checkout button label never wraps at 360px.</p><p>Delivery estimate comes from GET /api/cart/estimate.</p>';
  const page = (id, title, storage, parent) => ({ id, type: 'page', title, space: { key: 'QRD', name: 'Qonflo' }, version: { number: 1, when: iso(now - 3 * DAY) }, ancestors: parent ? [{ id: parent }] : [], body: { storage: { value: storage, representation: 'storage' } } });
  const pages = [
    page('5000', 'QRD Sprint pages', '<p>Sprint pages live here.</p>', null),
    page('5001', 'QRD Sprint 30 split', splitStorage, '5000'),
    page('5002', 'QRD-9000 working contract', contractStorage, '5000'),
  ];

  const commit = (seed, author, message, at) => ({ sha: sha(seed), author, message, date: iso(at) });
  const pr = (repo, number, ticket, title, author, branch, files, at) => ({
    repo, number, ticket, title, author, branch,
    body: `${ticket}\n\n${title}`,
    state: 'open', draft: false, merged: false, mergedAt: null, closedAt: null,
    createdAt: iso(at), updatedAt: iso(at),
    commits: [commit(`${repo}#${number}-1`, author, `feat(${ticket}): ${title}`, at)],
    reviews: [],
    files,
  });
  const prs = [
    pr('qonflo/dashboard', 101, 'QRD-9001', 'fix(QRD-9001): keep checkout button label on one line', OWNER, 'fix/QRD-9001-checkout-label', [{ filename: 'src/checkout/CheckoutButton.tsx', status: 'modified', additions: 4, deletions: 2 }], now - 6 * 3600 * 1000),
    pr('qonflo/backend', 201, 'QRD-9002', 'feat(QRD-9002): order notes API', OWNER, 'feat/QRD-9002-order-notes', [{ filename: 'src/orders/notes.ts', status: 'added', additions: 80, deletions: 0 }, { filename: 'src/orders/routes.ts', status: 'modified', additions: 12, deletions: 3 }], now - 5 * 3600 * 1000),
    pr('qonflo/dashboard', 102, 'QRD-9003', 'feat(QRD-9003): delivery estimate on cart page', TEAMMATE, 'feat/QRD-9003-delivery-estimate', [{ filename: 'src/cart/DeliveryEstimate.tsx', status: 'added', additions: 60, deletions: 0 }], now - 4 * 3600 * 1000),
  ];

  const prUrl = (item) => `https://github.com/${item.repo}/pull/${item.number}`;
  const thread = (id, name, ownerId, at) => ({ id, type: 11, guild_id: GUILD, parent_id: PR_FORUM, name, owner_id: ownerId, applied_tags: [], archived: false, createdAt: iso(at), messages: [] });
  const threads = [
    thread('100000000000002001', `QRD-9001 ${prs[0].title}`, WEBHOOK_ID, now - 6 * 3600 * 1000),
    thread('100000000000002002', `QRD-9002 ${prs[1].title}`, WEBHOOK_ID, now - 5 * 3600 * 1000),
    thread('100000000000002003', `QRD-9003 ${prs[2].title}`, TEAMMATE.discordId, now - 4 * 3600 * 1000),
  ];
  const state = {
    sprints: [sprint, future],
    issues,
    linkTypes: [linkType('10000', 'Blocks', 'is blocked by', 'blocks'), linkType('10003', 'Relates', 'relates to', 'relates to'), TEST_LINK_TYPE],
    comments: {},
    changelog: {},
    pages,
    nextPageId: 6000,
    prs,
    issuesGh: [],
    threads,
    received: { webhookPosts: [], webhookEdits: [], webhookDeletes: [], botPosts: [], jiraTransitions: [], jiraComments: [], jiraUpdates: [], jiraLinks: [], confluenceCreated: [], confluenceUpdated: [], githubReviews: [], githubMerges: [], githubReady: [], githubIssues: [], scripts: [] },
    requests: 0,
  };
  const webhookAuthor = { id: WEBHOOK_ID, username: OWNER.name, bot: true };
  addMessageTo(state, threads[0], { author: webhookAuthor, webhookId: WEBHOOK_ID, text: `QRD-9001 ready for review ${prUrl(prs[0])} -1`, at: now - 6 * 3600 * 1000 });
  addMessageTo(state, threads[1], { author: webhookAuthor, webhookId: WEBHOOK_ID, text: `QRD-9002 ready for review ${prUrl(prs[1])} -1`, at: now - 5 * 3600 * 1000 });
  addMessageTo(state, threads[2], { author: discordUser(TEAMMATE.discordId), text: `QRD-9003 please review ${prUrl(prs[2])} -1`, at: now - 4 * 3600 * 1000 });
  return state;
}

function discordUser(id) {
  if (id === OWNER.discordId) return { id, username: 'danu', global_name: OWNER.name };
  if (id === TEAMMATE.discordId) return { id, username: 'rizky', global_name: TEAMMATE.name };
  if (id === BOT.id) return BOT;
  return { id: String(id), username: `user${id}`, global_name: null };
}

function addMessageTo(state, thread, { author, text, webhookId, at = Date.now(), attachments = [] }) {
  const message = {
    id: snowflake(at),
    channel_id: thread.id,
    guild_id: GUILD,
    type: 0,
    content: String(text ?? ''),
    timestamp: iso(at),
    author,
    ...(webhookId ? { webhook_id: webhookId } : {}),
    mentions: [...String(text ?? '').matchAll(/<@!?(\d+)>/g)].map((match) => discordUser(match[1])),
    mention_roles: [],
    attachments,
  };
  thread.messages.push(message);
  return message;
}

const rawThread = (thread) => ({
  id: thread.id,
  type: thread.type,
  guild_id: GUILD,
  parent_id: thread.parent_id,
  name: thread.name,
  owner_id: thread.owner_id,
  last_message_id: thread.messages.at(-1)?.id ?? null,
  message_count: thread.messages.length,
  applied_tags: thread.applied_tags,
  thread_metadata: { archived: thread.archived, locked: false, archive_timestamp: thread.archivedAt ?? thread.createdAt, create_timestamp: thread.createdAt },
});

const FORUMS = [
  { id: PR_FORUM, type: 15, guild_id: GUILD, name: 'pr-review', available_tags: [] },
  { id: BUG_FORUM, type: 15, guild_id: GUILD, name: 'bug-report', available_tags: [] },
];

export function createMockServer({ port = 4610 } = {}) {
  let state = initialState();
  const base = () => `http://localhost:${port}`;
  const sockets = new Set();

  const prByRef = (ref) => {
    const text = String(ref ?? '');
    const url = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(text);
    if (url) return state.prs.find((item) => item.repo === url[1] && item.number === Number(url[2]));
    const hash = /^([^#]+)#(\d+)$/.exec(text);
    if (hash) return state.prs.find((item) => item.repo === hash[1] && item.number === Number(hash[2]));
    return state.prs.find((item) => item.number === Number(text));
  };
  const head = (item) => item.commits.at(-1);
  const ghUser = (user) => ({ login: user.github, id: user === OWNER ? 1111 : 2222, type: 'User', name: user.name });
  const prJson = (item) => ({
    url: `${base()}/github/repos/${item.repo}/pulls/${item.number}`,
    id: item.number * 1000,
    node_id: `PR_${item.repo.replace('/', '_')}_${item.number}`,
    html_url: `https://github.com/${item.repo}/pull/${item.number}`,
    repository_url: `${base()}/github/repos/${item.repo}`,
    number: item.number,
    state: item.state,
    draft: item.draft,
    title: item.title,
    body: item.body,
    user: ghUser(item.author),
    labels: [],
    requested_reviewers: [],
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    closed_at: item.closedAt,
    merged_at: item.mergedAt,
    merged: item.merged,
    mergeable: item.merged ? null : true,
    mergeable_state: item.merged ? 'unknown' : 'clean',
    head: { ref: item.branch, sha: head(item).sha, repo: { full_name: item.repo } },
    base: { ref: 'develop', sha: sha(`${item.repo}-develop`), repo: { full_name: item.repo } },
    additions: item.files.reduce((total, file) => total + file.additions, 0),
    deletions: item.files.reduce((total, file) => total + file.deletions, 0),
    changed_files: item.files.length,
    commits: item.commits.length,
  });
  const searchItem = (item) => ({ ...prJson(item), pull_request: { url: `${base()}/github/repos/${item.repo}/pulls/${item.number}`, html_url: `https://github.com/${item.repo}/pull/${item.number}`, merged_at: item.mergedAt } });
  const commitJson = (item, entry) => ({
    sha: entry.sha,
    html_url: `https://github.com/${item.repo}/commit/${entry.sha}`,
    commit: { message: entry.message, author: { name: entry.author.name, email: entry.author.email, date: entry.date }, committer: { name: entry.author.name, date: entry.date } },
    author: ghUser(entry.author),
  });
  const reviewJson = (item, review) => ({ id: review.id, user: { login: review.user, type: 'User' }, state: review.state, body: review.body ?? '', commit_id: review.commitId, submitted_at: review.at, html_url: `https://github.com/${item.repo}/pull/${item.number}#pullrequestreview-${review.id}` });

  const broadcast = (type, data) => {
    for (const socket of sockets) socket.dispatch(type, data);
  };
  const postMessage = (thread, options) => {
    const message = addMessageTo(state, thread, options);
    broadcast('MESSAGE_CREATE', { ...message, guild_id: GUILD });
    return message;
  };

  const issueByKey = (key) => state.issues.find((item) => item.key === String(key).toUpperCase());
  const setStatus = (issue, name, by = OWNER.name) => {
    const from = issue.fields.status.name;
    issue.fields.status = { name };
    issue.fields.updated = iso(Date.now());
    (state.changelog[issue.key] ??= []).push({ id: String(Date.now()), created: iso(Date.now()), author: { displayName: by }, items: [{ field: 'status', fromString: from, toString: name }] });
  };
  const jql = (query) => {
    let list = state.issues;
    const text = String(query ?? '');
    const keys = /key\s+in\s*\(([^)]*)\)/i.exec(text);
    if (keys) {
      const wanted = new Set(keys[1].split(',').map((key) => key.trim().replace(/"/g, '').toUpperCase()));
      list = list.filter((item) => wanted.has(item.key));
    }
    const label = /labels\s*=\s*"?([^"\s)]+)"?/i.exec(text);
    if (label) list = list.filter((item) => item.fields.labels.includes(label[1]));
    if (/assignee\s*=\s*currentUser\(\)/i.test(text)) list = list.filter((item) => item.fields.assignee?.accountId === OWNER.jira);
    if (/sprint\s+in\s+closedSprints\(\)/i.test(text)) list = [];
    const sprintId = /sprint\s*=\s*(\d+)/i.exec(text);
    if (sprintId) list = list.filter((item) => (item.fields.customfield_10020 ?? []).some((entry) => entry.id === Number(sprintId[1])));
    return list;
  };
  const issueJson = (issue, expand) => ({
    ...issue,
    self: `${base()}/jira/rest/api/3/issue/${issue.id}`,
    ...(String(expand ?? '').includes('changelog') ? { changelog: { histories: state.changelog[issue.key] ?? [] } } : {}),
  });

  const pageJson = (page) => ({ ...page, _links: { webui: `/spaces/QRD/pages/${page.id}`, base: `${base()}/jira/wiki` } });
  const cqlMatch = (cql) => {
    const text = String(cql ?? '');
    let list = state.pages;
    const title = /title\s*=\s*"([^"]*)"/i.exec(text);
    if (title) list = list.filter((page) => page.title === title[1].trim());
    const ancestor = /ancestor\s*=\s*(\d+)/i.exec(text);
    if (ancestor) list = list.filter((page) => page.ancestors.some((item) => item.id === ancestor[1]));
    const words = /text\s*~\s*"([^"]*)"/i.exec(text);
    if (words) list = list.filter((page) => `${page.title} ${page.body.storage.value}`.toLowerCase().includes(words[1].toLowerCase()));
    return list;
  };

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route('GET', /^\/__state$/, () => [200, { received: state.received, requests: state.requests, issues: state.issues.map((item) => ({ key: item.key, status: item.fields.status.name, labels: item.fields.labels, assignee: item.fields.assignee?.displayName ?? null })), pages: state.pages.map((page) => ({ id: page.id, title: page.title, version: page.version.number, parent: page.ancestors.at(-1)?.id ?? null })), prs: state.prs.map((item) => ({ repo: item.repo, number: item.number, ticket: item.ticket, state: item.state, merged: item.merged, head: head(item).sha, reviews: item.reviews.map((review) => ({ user: review.user, state: review.state, commitId: review.commitId })) })), threads: state.threads.map((thread) => ({ id: thread.id, name: thread.name, ownerId: thread.owner_id, messages: thread.messages.map((message) => ({ id: message.id, authorId: message.author.id, webhookId: message.webhook_id ?? null, text: message.content, at: message.timestamp })) })), gatewayClients: sockets.size }]);
  route('POST', /^\/__reset$/, () => { state = initialState(); return [200, { ok: true }]; });
  route('POST', /^\/__script$/, (_match, _query, body) => {
    const steps = Array.isArray(body) ? body : Array.isArray(body?.steps) ? body.steps : [body];
    const results = steps.map((step) => runScript(step ?? {}));
    state.received.scripts.push(...steps);
    return [200, { ok: true, results }];
  });

  function runScript(step) {
    const action = step.action;
    if (action === 'addMessage') {
      const thread = state.threads.find((item) => item.id === String(step.thread) || item.name.includes(String(step.thread)));
      if (!thread) return { error: `no thread ${step.thread}` };
      const author = step.webhookId ? { id: String(step.webhookId), username: step.username || OWNER.name, bot: true } : discordUser(String(step.authorId ?? TEAMMATE.discordId));
      const message = postMessage(thread, { author, text: step.text, webhookId: step.webhookId ? String(step.webhookId) : undefined, at: Date.now() - Math.max(0, Number(step.ageMs) || 0) });
      return { messageId: message.id, thread: thread.id };
    }
    if (action === 'addThread') {
      const at = Date.now();
      const thread = { id: snowflake(at), type: 11, guild_id: GUILD, parent_id: String(step.forum ?? PR_FORUM), name: String(step.name ?? 'New thread'), owner_id: String(step.authorId ?? TEAMMATE.discordId), applied_tags: [], archived: false, createdAt: iso(at), messages: [] };
      state.threads.push(thread);
      broadcast('THREAD_CREATE', rawThread(thread));
      const message = postMessage(thread, { author: discordUser(thread.owner_id), text: step.text ?? thread.name });
      return { thread: thread.id, messageId: message.id };
    }
    if (action === 'pushCommit') {
      const item = prByRef(step.pr);
      if (!item) return { error: `no pr ${step.pr}` };
      const at = Date.now();
      const entry = { sha: sha(`${item.repo}#${item.number}-${item.commits.length + 1}-${at}`), author: item.author, message: step.message ?? `fix(${item.ticket}): address review`, date: iso(at) };
      item.commits.push(entry);
      item.updatedAt = iso(at);
      return { sha: entry.sha };
    }
    if (action === 'mergePr') {
      const item = prByRef(step.pr);
      if (!item) return { error: `no pr ${step.pr}` };
      merge(item, step.by ?? 'script');
      return { merged: true };
    }
    if (action === 'setReview') {
      const item = prByRef(step.pr);
      if (!item) return { error: `no pr ${step.pr}` };
      const review = { id: Date.now() + item.reviews.length, user: step.user ?? (item.author === OWNER ? TEAMMATE.github : OWNER.github), state: String(step.state ?? 'APPROVED').toUpperCase(), body: step.body ?? '', commitId: head(item).sha, at: iso(Date.now()) };
      item.reviews.push(review);
      return { reviewId: review.id };
    }
    if (action === 'setLinkTypes') {
      state.linkTypes = state.linkTypes.filter((item) => item.name !== TEST_LINK_TYPE.name);
      if (step.test !== false) state.linkTypes.push(TEST_LINK_TYPE);
      return { linkTypes: state.linkTypes.map((item) => item.name) };
    }
    if (action === 'setIssue') {
      const issue = issueByKey(step.key);
      if (!issue) return { error: `no issue ${step.key}` };
      if (typeof step.summary === 'string') issue.fields.summary = step.summary;
      if (typeof step.description === 'string') issue.fields.description = adf(step.description);
      if (Array.isArray(step.ac)) issue.fields.customfield_10332 = adfList(step.ac);
      return { key: issue.key, summary: issue.fields.summary };
    }
    if (action === 'setIssueStatus') {
      const issue = issueByKey(step.key);
      if (!issue) return { error: `no issue ${step.key}` };
      setStatus(issue, String(step.status), 'script');
      return { status: issue.fields.status.name };
    }
    return { error: `unknown action ${action}` };
  }

  function merge(item, by) {
    item.merged = true;
    item.state = 'closed';
    item.mergedAt = iso(Date.now());
    item.closedAt = item.mergedAt;
    item.updatedAt = item.mergedAt;
    state.received.githubMerges.push({ repo: item.repo, number: item.number, by, at: item.mergedAt });
  }

  route('GET', /^\/jira\/rest\/api\/3\/myself$/, () => [200, jiraUser(OWNER)]);
  route('GET', /^\/jira\/rest\/api\/3\/project\/search$/, () => [200, { values: [{ id: '10001', key: 'QRD', name: 'Qonflo' }], isLast: true }]);
  route('POST', /^\/jira\/rest\/api\/3\/search\/jql$/, (_m, _q, body) => [200, { issues: jql(body?.jql).map((issue) => issueJson(issue, body?.expand)), isLast: true }]);
  route('GET', /^\/jira\/rest\/api\/3\/search\/jql$/, (_m, query) => [200, { issues: jql(query.get('jql')).map((issue) => issueJson(issue, query.get('expand'))), isLast: true }]);
  route('POST', /^\/jira\/rest\/api\/3\/search$/, (_m, _q, body) => { const list = jql(body?.jql); return [200, { issues: list.map((issue) => issueJson(issue, body?.expand)), total: list.length, startAt: 0, maxResults: list.length }]; });
  route('GET', /^\/jira\/rest\/api\/3\/search$/, (_m, query) => { const list = jql(query.get('jql')); return [200, { issues: list.map((issue) => issueJson(issue, query.get('expand'))), total: list.length, startAt: 0, maxResults: list.length }]; });
  route('GET', /^\/jira\/rest\/api\/3\/user\/assignable\/search$/, (_m, query) => [200, [OWNER, TEAMMATE].filter((user) => !query.get('query') || user.name.toLowerCase().includes(String(query.get('query')).toLowerCase())).map(jiraUser)]);
  route('GET', /^\/jira\/rest\/api\/3\/issueLinkType$/, () => [200, { issueLinkTypes: state.linkTypes }]);
  route('POST', /^\/jira\/rest\/api\/3\/issueLink$/, (_m, _q, body) => {
    const type = state.linkTypes.find((item) => item.name === body?.type?.name);
    if (!type) return [404, { errorMessages: [`No issue link type with name '${body?.type?.name}' found.`], errors: {} }];
    state.received.jiraLinks.push(body);
    const link = { name: type.name, inward: type.inward, outward: type.outward };
    issueByKey(body?.outwardIssue?.key)?.fields.issuelinks.push({ type: link, inwardIssue: { key: body.inwardIssue.key } });
    issueByKey(body?.inwardIssue?.key)?.fields.issuelinks.push({ type: link, outwardIssue: { key: body.outwardIssue.key } });
    return [201, null];
  });
  route('POST', /^\/jira\/rest\/api\/3\/issue$/, (_m, _q, body) => {
    const fields = body?.fields ?? {};
    if (!fields.summary) return [400, { errorMessages: [], errors: { summary: 'You must specify a summary of the issue.' } }];
    const base = state.issues.find((item) => item.fields.issuetype.name !== 'Epic');
    const number = Math.max(...state.issues.map((item) => Number(item.key.split('-')[1]))) + 1;
    const key = `QRD-${number}`;
    const user = [OWNER, TEAMMATE].find((item) => item.jira === fields.assignee?.accountId);
    const sprint = state.sprints.find((item) => item.id === Number(fields.customfield_10020));
    const issue = structuredClone(base);
    Object.assign(issue, { id: String(10000 + number), key });
    Object.assign(issue.fields, {
      summary: fields.summary, issuetype: { name: fields.issuetype?.name ?? 'Task' }, status: { name: 'To Do' }, assignee: user ? jiraUser(user) : null,
      labels: fields.labels ?? [], customfield_10332: fields.customfield_10332 ?? null, customfield_10016: fields.customfield_10016 ?? null,
      customfield_10020: sprint ? [sprint] : null, parent: fields.parent?.key ? { key: fields.parent.key, fields: { summary: fields.parent.key } } : undefined, issuelinks: [],
    });
    state.issues.push(issue);
    (state.received.jiraCreates ??= []).push({ key, fields });
    return [201, { id: issue.id, key, self: `/rest/api/3/issue/${issue.id}` }];
  });
  route('GET', /^\/jira\/rest\/api\/3\/issue\/([^/]+)\/transitions$/, (m) => {
    const issue = issueByKey(m[1]);
    if (!issue) return [404, { errorMessages: ['Issue does not exist'] }];
    return [200, { transitions: STATUSES.map((name, index) => ({ id: String(11 + index), name, to: { name } })).filter((item) => item.to.name !== issue.fields.status.name) }];
  });
  route('POST', /^\/jira\/rest\/api\/3\/issue\/([^/]+)\/transitions$/, (m, _q, body) => {
    const issue = issueByKey(m[1]);
    if (!issue) return [404, { errorMessages: ['Issue does not exist'] }];
    const name = STATUSES[Number(body?.transition?.id) - 11];
    if (!name) return [400, { errorMessages: ['Unknown transition'] }];
    state.received.jiraTransitions.push({ key: issue.key, from: issue.fields.status.name, to: name, at: iso(Date.now()) });
    setStatus(issue, name);
    return [204, null];
  });
  route('GET', /^\/jira\/rest\/api\/3\/issue\/([^/]+)\/comment$/, (m) => { const list = state.comments[String(m[1]).toUpperCase()] ?? []; return [200, { comments: list, total: list.length, startAt: 0, maxResults: list.length }]; });
  route('POST', /^\/jira\/rest\/api\/3\/issue\/([^/]+)\/comment$/, (m, _q, body) => {
    const key = String(m[1]).toUpperCase();
    const comment = { id: String(Date.now()), created: iso(Date.now()), author: jiraUser(OWNER), body: body?.body ?? null };
    (state.comments[key] ??= []).push(comment);
    state.received.jiraComments.push({ key, body: comment.body });
    return [201, comment];
  });
  route('GET', /^\/jira\/rest\/api\/3\/issue\/([^/]+)\/changelog$/, (m) => { const list = state.changelog[String(m[1]).toUpperCase()] ?? []; return [200, { values: list, isLast: true, total: list.length }]; });
  route('PUT', /^\/jira\/rest\/api\/3\/issue\/([^/]+)\/assignee$/, (m, _q, body) => {
    const issue = issueByKey(m[1]);
    if (!issue) return [404, { errorMessages: ['Issue does not exist'] }];
    const user = [OWNER, TEAMMATE].find((item) => item.jira === body?.accountId);
    issue.fields.assignee = user ? jiraUser(user) : null;
    state.received.jiraUpdates.push({ key: issue.key, assignee: body?.accountId ?? null });
    return [204, null];
  });
  route('GET', /^\/jira\/rest\/api\/3\/issue\/([^/]+)$/, (m, query) => { const issue = issueByKey(m[1]); return issue ? [200, issueJson(issue, query.get('expand'))] : [404, { errorMessages: ['Issue does not exist'] }]; });
  route('PUT', /^\/jira\/rest\/api\/3\/issue\/([^/]+)$/, (m, _q, body) => {
    const issue = issueByKey(m[1]);
    if (!issue) return [404, { errorMessages: ['Issue does not exist'] }];
    Object.assign(issue.fields, body?.fields ?? {});
    for (const change of body?.update?.labels ?? []) {
      if (change.add && !issue.fields.labels.includes(change.add)) issue.fields.labels.push(change.add);
      if (change.remove) issue.fields.labels = issue.fields.labels.filter((label) => label !== change.remove);
    }
    issue.fields.updated = iso(Date.now());
    state.received.jiraUpdates.push({ key: issue.key, fields: body?.fields ?? null, update: body?.update ?? null });
    return [204, null];
  });
  route('GET', /^\/jira\/rest\/agile\/1\.0\/board$/, () => [200, { values: [{ id: 1, name: 'QRD board', type: 'scrum', location: { projectKey: 'QRD' } }], isLast: true, startAt: 0, maxResults: 50, total: 1 }]);
  route('GET', /^\/jira\/rest\/agile\/1\.0\/board\/(\d+)\/sprint$/, (_m, query) => {
    const wanted = String(query.get('state') ?? 'active,closed,future').split(',');
    return [200, { values: state.sprints.filter((sprint) => wanted.includes(sprint.state)), isLast: true, startAt: 0, maxResults: 50 }];
  });
  route('GET', /^\/jira\/rest\/agile\/1\.0\/sprint\/(\d+)$/, (m) => { const sprint = state.sprints.find((item) => item.id === Number(m[1])); return sprint ? [200, sprint] : [404, null]; });
  route('GET', /^\/jira\/rest\/agile\/1\.0\/sprint\/(\d+)\/issue$/, (m) => { const list = jql(`sprint = ${m[1]}`); return [200, { issues: list.map((issue) => issueJson(issue)), total: list.length, startAt: 0, maxResults: list.length }]; });

  route('GET', /^\/jira\/wiki\/rest\/api\/content\/search$/, (_m, query) => [200, { results: cqlMatch(query.get('cql')).slice(0, Number(query.get('limit') ?? 25)).map(pageJson), size: 0 }]);
  route('GET', /^\/jira\/wiki\/rest\/api\/search$/, (_m, query) => [200, { results: cqlMatch(query.get('cql')).map((page) => ({ content: pageJson(page), title: page.title })) }]);
  route('GET', /^\/jira\/wiki\/rest\/api\/content$/, (_m, query) => [200, { results: state.pages.filter((page) => (!query.get('title') || page.title === query.get('title')) && (!query.get('spaceKey') || page.space.key === query.get('spaceKey'))).slice(0, Number(query.get('limit') ?? 25)).map(pageJson) }]);
  route('POST', /^\/jira\/wiki\/rest\/api\/content$/, (_m, _q, body) => {
    if (state.pages.some((page) => page.title === body?.title && page.space.key === body?.space?.key)) return [400, { message: 'A page with this title already exists' }];
    const page = { id: String(state.nextPageId += 1), type: 'page', title: String(body?.title ?? ''), space: { key: body?.space?.key ?? 'QRD', name: 'Qonflo' }, version: { number: 1, when: iso(Date.now()) }, ancestors: (body?.ancestors ?? []).map((item) => ({ id: String(item.id) })), body: { storage: { value: String(body?.body?.storage?.value ?? ''), representation: 'storage' } } };
    state.pages.push(page);
    state.received.confluenceCreated.push({ id: page.id, title: page.title, parent: page.ancestors.at(-1)?.id ?? null, storage: page.body.storage.value });
    return [200, pageJson(page)];
  });
  route('GET', /^\/jira\/wiki\/rest\/api\/content\/(\d+)\/child\/page$/, (m) => [200, { results: state.pages.filter((page) => page.ancestors.at(-1)?.id === m[1]).map(pageJson) }]);
  route('GET', /^\/jira\/wiki\/rest\/api\/content\/(\d+)\/child\/attachment$/, () => [200, { results: [] }]);
  route('GET', /^\/jira\/wiki\/rest\/api\/content\/(\d+)$/, (m) => { const page = state.pages.find((item) => item.id === m[1]); return page ? [200, pageJson(page)] : [404, { message: 'No content found' }]; });
  route('PUT', /^\/jira\/wiki\/rest\/api\/content\/(\d+)$/, (m, _q, body) => {
    const page = state.pages.find((item) => item.id === m[1]);
    if (!page) return [404, { message: 'No content found' }];
    if (Number(body?.version?.number) !== page.version.number + 1) return [409, { message: 'Version must be incremented on update' }];
    page.version = { number: page.version.number + 1, when: iso(Date.now()) };
    if (body?.title) page.title = String(body.title);
    if (body?.body?.storage) page.body.storage.value = String(body.body.storage.value ?? '');
    state.received.confluenceUpdated.push({ id: page.id, title: page.title, version: page.version.number, storage: page.body.storage.value });
    return [200, pageJson(page)];
  });
  route('GET', /^\/jira\/wiki\/api\/v2\/pages\/(\d+)$/, (m) => { const page = state.pages.find((item) => item.id === m[1]); return page ? [200, { id: page.id, title: page.title, spaceId: '1', parentId: page.ancestors.at(-1)?.id ?? null, version: page.version, body: { storage: page.body.storage } }] : [404, null]; });

  route('GET', /^\/github\/user$/, () => [200, ghUser(OWNER)]);
  route('GET', /^\/github\/user\/repos$/, () => [200, ['qonflo/dashboard', 'qonflo/backend'].map((full, index) => ({ id: index + 1, name: full.split('/')[1], full_name: full, private: true, html_url: `https://github.com/${full}`, description: 'e2e mock repo' }))]);
  route('GET', /^\/github\/user\/(orgs|teams)$/, () => [200, []]);
  route('GET', /^\/github\/search\/issues$/, (_m, query) => {
    const q = String(query.get('q') ?? '');
    const repos = [...q.matchAll(/repo:(\S+)/g)].map((match) => match[1]);
    const quoted = /"([^"]+)"/.exec(q)?.[1];
    const list = state.prs.filter((item) => (!repos.length || repos.includes(item.repo))
      && (!quoted || `${item.title} ${item.branch} ${item.body}`.includes(quoted))
      && (!/author:@me/.test(q) || item.author === OWNER)
      && (!/state:open/.test(q) || item.state === 'open'));
    return [200, { total_count: list.length, incomplete_results: false, items: list.map(searchItem) }];
  });
  route('POST', /^\/github\/graphql$/, (_m, _q, body) => {
    const id = body?.variables?.id;
    const item = state.prs.find((entry) => prJson(entry).node_id === id);
    if (item) { item.draft = false; state.received.githubReady.push({ repo: item.repo, number: item.number }); }
    return [200, { data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } }];
  });
  const repoRe = '([^/]+\\/[^/]+)';
  route('GET', new RegExp(`^/github/repos/${repoRe}/pulls$`), (m, query) => [200, state.prs.filter((item) => item.repo === m[1] && (query.get('state') === 'all' || item.state === (query.get('state') ?? 'open'))).map(prJson)]);
  const pull = (m) => state.prs.find((item) => item.repo === m[1] && item.number === Number(m[2]));
  route('GET', new RegExp(`^/github/repos/${repoRe}/pulls/(\\d+)$`), (m) => { const item = pull(m); return item ? [200, prJson(item)] : [404, { message: 'Not Found' }]; });
  route('GET', new RegExp(`^/github/repos/${repoRe}/pulls/(\\d+)/files$`), (m) => { const item = pull(m); return item ? [200, item.files.map((file) => ({ ...file, changes: file.additions + file.deletions, blob_url: `https://github.com/${item.repo}/blob/${head(item).sha}/${file.filename}`, patch: '@@ -1 +1 @@' }))] : [404, { message: 'Not Found' }]; });
  route('GET', new RegExp(`^/github/repos/${repoRe}/pulls/(\\d+)/commits$`), (m) => { const item = pull(m); return item ? [200, item.commits.map((entry) => commitJson(item, entry))] : [404, { message: 'Not Found' }]; });
  route('GET', new RegExp(`^/github/repos/${repoRe}/pulls/(\\d+)/reviews$`), (m) => { const item = pull(m); return item ? [200, item.reviews.map((review) => reviewJson(item, review))] : [404, { message: 'Not Found' }]; });
  route('POST', new RegExp(`^/github/repos/${repoRe}/pulls/(\\d+)/reviews$`), (m, _q, body) => {
    const item = pull(m);
    if (!item) return [404, { message: 'Not Found' }];
    const stateName = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' }[body?.event] ?? 'PENDING';
    const review = { id: Date.now() + item.reviews.length, user: OWNER.github, state: stateName, body: body?.body ?? '', commitId: body?.commit_id ?? head(item).sha, at: iso(Date.now()) };
    item.reviews.push(review);
    state.received.githubReviews.push({ repo: item.repo, number: item.number, state: stateName, body: review.body, commitId: review.commitId });
    return [200, reviewJson(item, review)];
  });
  route('PUT', new RegExp(`^/github/repos/${repoRe}/pulls/(\\d+)/merge$`), (m) => {
    const item = pull(m);
    if (!item) return [404, { message: 'Not Found' }];
    if (item.merged) return [405, { message: 'Pull Request is not mergeable' }];
    merge(item, OWNER.github);
    return [200, { sha: head(item).sha, merged: true, message: 'Pull Request successfully merged' }];
  });
  const commitBySha = (repo, value) => state.prs.filter((item) => item.repo === repo).flatMap((item) => item.commits.map((entry) => ({ item, entry }))).find(({ entry }) => entry.sha === value || entry.sha.startsWith(value));
  route('GET', new RegExp(`^/github/repos/${repoRe}/commits/([0-9a-f]+)/check-runs$`), () => [200, { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }] }]);
  route('GET', new RegExp(`^/github/repos/${repoRe}/commits/([0-9a-f]+)/status$`), () => [200, { state: 'success', statuses: [{ context: 'ci', state: 'success' }], total_count: 1 }]);
  route('GET', new RegExp(`^/github/repos/${repoRe}/commits/([0-9a-f]+)$`), (m) => { const found = commitBySha(m[1], m[2]); return found ? [200, commitJson(found.item, found.entry)] : [404, { message: 'No commit found' }]; });
  route('GET', new RegExp(`^/github/repos/${repoRe}/compare/([0-9a-f]+)\\.\\.\\.([0-9a-f]+)$`), (m) => {
    const base = commitBySha(m[1], m[2]);
    const tip = commitBySha(m[1], m[3]);
    if (m[2] === m[3]) return [200, { status: 'identical' }];
    if (base && tip && base.item === tip.item) return [200, { status: tip.item.commits.indexOf(tip.entry) > tip.item.commits.indexOf(base.entry) ? 'ahead' : 'behind' }];
    return [200, { status: 'diverged' }];
  });
  route('GET', new RegExp(`^/github/repos/${repoRe}/contents/(.+)$`), (m) => [200, `// ${decodeURIComponent(m[2])} (e2e mock)\n`]);
  route('GET', new RegExp(`^/github/repos/${repoRe}/actions/workflows/([^/]+)/runs$`), () => [200, { total_count: 0, workflow_runs: [] }]);
  route('GET', new RegExp(`^/github/repos/${repoRe}/issues$`), (m) => [200, state.issuesGh.filter((item) => item.repo === m[1]).map((item) => item.json)]);
  route('POST', new RegExp(`^/github/repos/${repoRe}/issues$`), (m, _q, body) => {
    const number = 500 + state.issuesGh.length + 1;
    const json = { number, title: body?.title ?? '', body: body?.body ?? '', state: 'open', html_url: `https://github.com/${m[1]}/issues/${number}`, user: ghUser(OWNER), created_at: iso(Date.now()), updated_at: iso(Date.now()), comments: 0 };
    state.issuesGh.push({ repo: m[1], json });
    state.received.githubIssues.push({ repo: m[1], number, title: json.title });
    return [201, json];
  });
  route('GET', new RegExp(`^/github/repos/${repoRe}/issues/(\\d+)$`), (m) => { const found = state.issuesGh.find((item) => item.repo === m[1] && item.json.number === Number(m[2])); return found ? [200, found.json] : [404, { message: 'Not Found' }]; });
  route('GET', new RegExp(`^/github/repos/${repoRe}/issues/(\\d+)/comments$`), () => [200, []]);
  route('GET', new RegExp(`^/github/repos/${repoRe}$`), (m) => [200, { id: 1, name: m[1].split('/')[1], full_name: m[1], private: true, default_branch: 'develop', html_url: `https://github.com/${m[1]}` }]);

  const discordRoot = '/discord/api(?:/v10)?';
  const threadById = (id) => state.threads.find((item) => item.id === id);
  route('GET', new RegExp(`^${discordRoot}/users/@me$`), () => [200, BOT]);
  route('GET', new RegExp(`^${discordRoot}/gateway(?:/bot)?$`), () => [200, { url: `ws://localhost:${port}/discord/gateway`, shards: 1, session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 } }]);
  route('GET', new RegExp(`^${discordRoot}/guilds/(\\d+)/threads/active$`), () => [200, { threads: state.threads.filter((thread) => !thread.archived).map(rawThread), members: [] }]);
  route('GET', new RegExp(`^${discordRoot}/guilds/(\\d+)/roles$`), () => [200, [{ id: GUILD, name: '@everyone' }]]);
  route('GET', new RegExp(`^${discordRoot}/guilds/(\\d+)/channels$`), () => [200, FORUMS.map((forum) => ({ id: forum.id, name: forum.name, type: forum.type }))]);
  route('GET', new RegExp(`^${discordRoot}/guilds/(\\d+)/members/(\\d+)$`), (m) => [200, { user: discordUser(m[2]), roles: [] }]);
  route('GET', new RegExp(`^${discordRoot}/channels/(\\d+)/threads/archived/public$`), (m) => [200, { threads: state.threads.filter((thread) => thread.archived && thread.parent_id === m[1]).map(rawThread), members: [], has_more: false }]);
  route('GET', new RegExp(`^${discordRoot}/channels/(\\d+)/messages$`), (m, query) => {
    const thread = threadById(m[1]);
    if (!thread) return [404, { message: 'Unknown Channel', code: 10003 }];
    return [200, [...thread.messages].reverse().slice(0, Number(query.get('limit') ?? 50))];
  });
  route('POST', new RegExp(`^${discordRoot}/channels/(\\d+)/messages$`), (m, _q, body) => {
    const thread = threadById(m[1]);
    if (!thread) return [404, { message: 'Unknown Channel', code: 10003 }];
    const message = postMessage(thread, { author: BOT, text: body?.content });
    state.received.botPosts.push({ thread: thread.id, id: message.id, content: message.content });
    return [200, message];
  });
  route('GET', new RegExp(`^${discordRoot}/channels/(\\d+)$`), (m) => {
    const forum = FORUMS.find((item) => item.id === m[1]);
    if (forum) return [200, forum];
    const thread = threadById(m[1]);
    return thread ? [200, rawThread(thread)] : [404, { message: 'Unknown Channel', code: 10003 }];
  });
  route('POST', new RegExp(`^${discordRoot}/attachments/refresh-urls$`), (_m, _q, body) => [200, { refreshed_urls: (body?.attachment_urls ?? []).map((url) => ({ original: url, refreshed: url })) }]);

  const webhookRe = `^${discordRoot}/webhooks/(\\d+)/([\\w-]+)`;
  route('GET', new RegExp(`${webhookRe}$`), (m) => [200, { id: m[1], type: 1, name: OWNER.name, channel_id: PR_FORUM, guild_id: GUILD, token: m[2] }]);
  route('POST', new RegExp(`${webhookRe}$`), (m, query, body, files) => {
    const threadId = query.get('thread_id');
    let thread = threadId ? threadById(threadId) : null;
    if (threadId && !thread) return [404, { message: 'Unknown Channel', code: 10003 }];
    if (!thread && !body?.thread_name) return [400, { message: 'Webhooks posted to forum channels must have a thread_name or thread_id', code: 220001 }];
    if (!thread) {
      const at = Date.now();
      thread = { id: snowflake(at), type: 11, guild_id: GUILD, parent_id: PR_FORUM, name: String(body.thread_name), owner_id: m[1], applied_tags: [], archived: false, createdAt: iso(at), messages: [] };
      state.threads.push(thread);
      broadcast('THREAD_CREATE', rawThread(thread));
    }
    const attachments = files.map((file, index) => ({ id: snowflake(), filename: file.name, size: file.size, content_type: 'image/png', url: `${base()}/discord/cdn/${file.name}?ex=${Math.floor(Date.now() / 1000 + 86400).toString(16)}`, width: null, height: null, index }));
    const message = postMessage(thread, { author: { id: m[1], username: body?.username || OWNER.name, bot: true }, webhookId: m[1], text: body?.content, attachments });
    state.received.webhookPosts.push({ webhookId: m[1], thread: thread.id, threadName: thread.name, id: message.id, content: message.content, username: body?.username ?? null, files: files.map((file) => file.name), wait: query.get('wait') === 'true' });
    return query.get('wait') === 'true' ? [200, message] : [204, null];
  });
  route('PATCH', new RegExp(`${webhookRe}/messages/(\\d+)$`), (m, query, body) => {
    const thread = threadById(query.get('thread_id') ?? '');
    const message = thread?.messages.find((item) => item.id === m[3]);
    if (!message) return [404, { message: 'Unknown Message', code: 10008 }];
    message.content = String(body?.content ?? message.content);
    message.edited_timestamp = iso(Date.now());
    state.received.webhookEdits.push({ thread: thread.id, id: message.id, content: message.content });
    broadcast('MESSAGE_UPDATE', { ...message, guild_id: GUILD });
    return [200, message];
  });
  route('DELETE', new RegExp(`${webhookRe}/messages/(\\d+)$`), (m, query) => {
    const thread = threadById(query.get('thread_id') ?? '');
    const index = thread ? thread.messages.findIndex((item) => item.id === m[3]) : -1;
    if (index < 0) return [404, { message: 'Unknown Message', code: 10008 }];
    thread.messages.splice(index, 1);
    state.received.webhookDeletes.push({ thread: thread.id, id: m[3] });
    broadcast('MESSAGE_DELETE', { id: m[3], channel_id: thread.id, guild_id: GUILD });
    return [204, null];
  });
  route('GET', /^\/health$/, () => [200, { ok: true }]);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', base());
    state.requests += 1;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const { body, files } = parseBody(request.headers['content-type'] ?? '', raw);
    const found = routes.find((entry) => entry.method === request.method && entry.pattern.test(url.pathname));
    let status = 404;
    let payload = { message: `mock has no route for ${request.method} ${url.pathname}` };
    if (found) {
      try {
        [status, payload] = found.handler(found.pattern.exec(url.pathname), url.searchParams, body, files);
      } catch (error) {
        status = 500;
        payload = { message: error instanceof Error ? error.message : 'mock error' };
      }
    } else if (process.env.MOCK_VERBOSE !== '0') {
      process.stderr.write(`[mock] 404 ${request.method} ${url.pathname}\n`);
    }
    if (status === 204 || payload === null) {
      response.writeHead(status);
      response.end();
      return;
    }
    if (typeof payload === 'string') {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(payload);
      return;
    }
    response.writeHead(status, { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) });
    response.end(JSON.stringify(payload));
  });

  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url ?? '/', base());
    const key = request.headers['sec-websocket-key'];
    if (!url.pathname.startsWith('/discord/gateway') || !key) {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(gatewaySession(socket, sockets, port));
  });

  return {
    server,
    get state() { return state; },
    script: runScript,
    listen: () => new Promise((resolve) => server.listen(port, () => resolve(server))),
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.end();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

function gatewaySession(socket, sockets, port) {
  let seq = 0;
  let buffer = Buffer.alloc(0);
  let ready = false;
  const sessionId = randomBytes(8).toString('hex');
  const send = (payload) => {
    if (socket.destroyed) return;
    const data = Buffer.from(JSON.stringify(payload));
    const header = data.length < 126
      ? Buffer.from([0x81, data.length])
      : data.length < 65536
        ? Buffer.from([0x81, 126, data.length >> 8, data.length & 0xff])
        : Buffer.concat([Buffer.from([0x81, 127]), (() => { const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(data.length)); return size; })()]);
    socket.write(Buffer.concat([header, data]));
  };
  const session = {
    dispatch: (type, data) => { if (ready) send({ op: 0, t: type, s: (seq += 1), d: data }); },
    end: () => socket.destroy(),
  };
  const close = () => { sockets.delete(session); socket.destroy(); };
  const handle = (text) => {
    let payload;
    try { payload = JSON.parse(text); } catch { return; }
    if (payload.op === 1) send({ op: 11 });
    else if (payload.op === 2) {
      ready = true;
      send({ op: 0, t: 'READY', s: (seq += 1), d: { v: 10, user: BOT, guilds: [{ id: GUILD, unavailable: true }], session_id: sessionId, resume_gateway_url: `ws://localhost:${port}/discord/gateway` } });
    } else if (payload.op === 6) send({ op: 9, d: false });
  };
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      const data = Buffer.from(buffer.subarray(offset, offset + length));
      if (masked) for (let index = 0; index < data.length; index += 1) data[index] ^= buffer[maskOffset + (index % 4)];
      buffer = buffer.subarray(offset + length);
      if (opcode === 8) { close(); return; }
      if (opcode === 9) socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
      if (opcode === 1) handle(data.toString('utf8'));
    }
  });
  socket.on('close', () => sockets.delete(session));
  socket.on('error', () => sockets.delete(session));
  send({ op: 10, d: { heartbeat_interval: 41250 } });
  return session;
}

function parseBody(type, raw) {
  if (!raw.length) return { body: null, files: [] };
  if (type.startsWith('multipart/form-data')) {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    const mark = `--${boundary?.[1] ?? boundary?.[2] ?? ''}`;
    const text = raw.toString('latin1');
    let body = null;
    const files = [];
    for (const part of text.split(mark).slice(1, -1)) {
      const split = part.indexOf('\r\n\r\n');
      const headers = part.slice(0, split);
      const content = part.slice(split + 4).replace(/\r\n$/, '');
      const name = /name="([^"]+)"/i.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      if (filename !== undefined) files.push({ field: name, name: filename, size: Buffer.byteLength(content, 'latin1') });
      else if (name === 'payload_json') body = JSON.parse(Buffer.from(content, 'latin1').toString('utf8'));
    }
    return { body, files };
  }
  const text = raw.toString('utf8');
  try { return { body: JSON.parse(text), files: [] }; } catch { return { body: text, files: [] }; }
}

export const MOCK_IDS = { GUILD, PR_FORUM, BUG_FORUM, WEBHOOK_ID, WEBHOOK_TOKEN, OWNER, TEAMMATE, CONFLUENCE_PARENT: '5000', SPLIT_PAGE: '5001', CONTRACT_PAGE: '5002', BOARD: 1, SPRINT: 100 };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = process.argv.indexOf('--port');
  const port = Number(flag > 0 ? process.argv[flag + 1] : process.env.MOCK_PORT || 4610);
  const mock = createMockServer({ port });
  await mock.listen();
  process.stdout.write(`DOCK e2e mock on http://localhost:${port} (GET /__state, POST /__script)\n`);
  const stop = () => mock.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
