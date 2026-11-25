import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GitHubQuotaBadge } from '../components/GitHubQuotaBadge';
import { githubQuotaText } from '../lib/githubQuota';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

test('a used-up GitHub quota says data comes from the cache until the reset', () => {
  const quota = { limited: true, remaining: 0, resetAt: '2026-11-25T10:08:00.000Z' };
  assert.equal(githubQuotaText(quota, () => '17:08'), 'GitHub quota used up — data from cache until 17:08');
  const html = renderToStaticMarkup(<GitHubQuotaBadge quota={quota} />);
  assert.match(html, /role="status"/);
  assert.match(html, /GitHub quota used up — data from cache until \d{2}:\d{2}/);
  assert.match(html, /bg-status-conflict-bg/);
});

test('a low GitHub quota says background refresh is paused', () => {
  const quota = { limited: false, remaining: 312, resetAt: '2026-11-25T10:08:00.000Z' };
  assert.equal(githubQuotaText(quota), 'GitHub quota low (312 left) — background refresh paused');
  const html = renderToStaticMarkup(<GitHubQuotaBadge quota={quota} />);
  assert.match(html, /GitHub quota low \(312 left\) — background refresh paused/);
  assert.match(html, /bg-status-warn-bg/);
});

test('the badge is hidden while the quota is fine or unknown', () => {
  for (const quota of [undefined, null, { limited: false, remaining: null, resetAt: null }, { limited: false, remaining: 500, resetAt: '2026-11-25T10:08:00.000Z' }, { limited: false, remaining: 4800, resetAt: '2026-11-25T10:08:00.000Z' }]) {
    assert.equal(renderToStaticMarkup(<GitHubQuotaBadge quota={quota} />), '', JSON.stringify(quota));
  }
});

test('Home asks for the GitHub quota once a minute and shows the badge under the summary', () => {
  const home = read('pages/HomePage.tsx');
  assert.match(home, /useQuery<\{ githubQuota: GitHubQuota \}>\(GET_GITHUB_QUOTA, \{ \.\.\.CACHED_QUERY_OPTIONS, pollInterval: 60000 \}\)/);
  assert.match(home, /<GitHubQuotaBadge quota=\{quotaData\?\.githubQuota\}/);
  assert.match(read('graphql/queries.ts'), /query GetGithubQuota \{\s*githubQuota \{ limited remaining resetAt \}\s*\}/);
});
