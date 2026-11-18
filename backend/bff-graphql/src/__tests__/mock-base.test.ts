import assert from 'node:assert';
import test from 'node:test';
import { atlassianMockBase, discordApiBase, discordGatewayUrl, githubApiBase, isMockDiscordWebhookUrl } from '../integrations/mock-base';
import { atlassianBaseUrl } from '../integrations/jira';
import { isDiscordWebhookUrl } from '../datasources/StorageAPI';

const REAL_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const MOCK = { DOCK_MOCK_URL: 'http://localhost:4610/' };

test('without DOCK_MOCK_URL every base stays the real service', () => {
  assert.strictEqual(githubApiBase({}), 'https://api.github.com');
  assert.strictEqual(discordApiBase({}), 'https://discord.com/api/v10');
  assert.strictEqual(discordGatewayUrl(REAL_GATEWAY, {}), REAL_GATEWAY);
  assert.strictEqual(atlassianMockBase({}), '');
  assert.strictEqual(atlassianBaseUrl('acme.atlassian.net', {}), 'https://acme.atlassian.net');
  assert.strictEqual(githubApiBase({ DOCK_MOCK_URL: '  ' }), 'https://api.github.com');
  assert.strictEqual(isMockDiscordWebhookUrl('http://localhost:4610/discord/api/webhooks/1/x', {}), false);
});

test('with DOCK_MOCK_URL the bases point at the mock server', () => {
  assert.strictEqual(githubApiBase(MOCK), 'http://localhost:4610/github');
  assert.strictEqual(discordApiBase(MOCK), 'http://localhost:4610/discord/api/v10');
  assert.strictEqual(discordGatewayUrl(REAL_GATEWAY, MOCK), 'ws://localhost:4610/discord/gateway/?v=10&encoding=json');
  assert.strictEqual(atlassianBaseUrl('acme.atlassian.net', MOCK), 'http://localhost:4610/jira');
  assert.strictEqual(atlassianBaseUrl('acme.atlassian.net', { ...MOCK, DOCK_ATLASSIAN_BASE_URL: 'http://fake:1' }), 'http://fake:1');
});

test('a mock webhook link is accepted only on the mock while DOCK_MOCK_URL is set', () => {
  assert.strictEqual(isMockDiscordWebhookUrl('http://localhost:4610/discord/api/webhooks/123/tok-en', MOCK), true);
  assert.strictEqual(isMockDiscordWebhookUrl('http://localhost:4610/discord/api/webhooks/abc/token', MOCK), false);
  assert.strictEqual(isMockDiscordWebhookUrl('http://evil.test/discord/api/webhooks/123/token', MOCK), false);
  const before = process.env.DOCK_MOCK_URL;
  try {
    delete process.env.DOCK_MOCK_URL;
    assert.strictEqual(isDiscordWebhookUrl('http://localhost:4610/discord/api/webhooks/123/token'), false);
    assert.strictEqual(isDiscordWebhookUrl('https://discord.com/api/webhooks/123/token'), true);
    process.env.DOCK_MOCK_URL = 'http://localhost:4610';
    assert.strictEqual(isDiscordWebhookUrl('http://localhost:4610/discord/api/webhooks/123/token'), true);
  } finally {
    if (before === undefined) delete process.env.DOCK_MOCK_URL;
    else process.env.DOCK_MOCK_URL = before;
  }
});
