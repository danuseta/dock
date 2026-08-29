import assert from 'node:assert/strict';
import test from 'node:test';
import { getWebsiteIconSources } from '../lib/websiteIcon';

test('uses the destination origin favicon before the public fallback service', () => {
  assert.deepEqual(getWebsiteIconSources('https://jira.example.com/projects?a=1'), [
    'https://jira.example.com/apple-touch-icon.png',
    'https://jira.example.com/favicon.svg',
    'https://jira.example.com/favicon.ico',
    'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fjira.example.com&sz=128',
  ]);
});

test('returns no remote icon sources for an invalid URL', () => {
  assert.deepEqual(getWebsiteIconSources('not-a-url'), []);
});
