import assert from 'node:assert/strict';
import test from 'node:test';
import { getWebsiteIconKind, getWebsiteIconSources } from '../lib/websiteIcon';

test('uses the destination origin favicon before the public fallback service', () => {
  assert.deepEqual(getWebsiteIconSources('https://jira.example.com/projects?a=1'), [
    'https://jira.example.com/favicon-192x192.png',
    'https://jira.example.com/apple-touch-icon.png',
    'https://jira.example.com/favicon-96x96.png',
    'https://jira.example.com/favicon.svg',
    'https://jira.example.com/favicon.ico',
    'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fjira.example.com&sz=128',
  ]);
});

test('returns no remote icon sources for an invalid URL', () => {
  assert.deepEqual(getWebsiteIconSources('not-a-url'), []);
});

test('selects local vector marks for common quick-link services', () => {
  assert.equal(getWebsiteIconKind('https://github.com/danuseta'), 'github');
  assert.equal(getWebsiteIconKind('https://calendar.google.com/calendar/u/0'), 'calendar');
  assert.equal(getWebsiteIconKind('https://mysales.atlassian.net/jira/software/projects/QRD/boards/40/backlog'), 'jira');
  assert.equal(getWebsiteIconKind('https://100.105.125.100:3101'), 'server');
});

test('uses the title to identify a known service on a custom domain', () => {
  assert.equal(getWebsiteIconKind('https://jira.internal.example', 'Jira board'), 'jira');
});
