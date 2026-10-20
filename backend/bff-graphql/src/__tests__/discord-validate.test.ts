import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordAPI } from '../datasources/DiscordAPI';

const api = (saved: string | undefined, tested: string[]) => new DiscordAPI(
  { sendSummary: async () => undefined, validateWebhook: async (url: string) => { tested.push(url); return true; } },
  { getSettings: async () => ({ discordWebhookUrl: saved }) },
);

test('a blank webhook tests the saved one, as Jira and GitHub test their saved credentials', async () => {
  const tested: string[] = [];
  assert.equal((await api('https://discord.com/api/webhooks/saved', tested).validateDiscord('')).success, true);
  assert.deepEqual(tested, ['https://discord.com/api/webhooks/saved']);
});

test('a typed webhook is tested instead of the saved one', async () => {
  const tested: string[] = [];
  await api('https://discord.com/api/webhooks/saved', tested).validateDiscord('https://discord.com/api/webhooks/typed');
  assert.deepEqual(tested, ['https://discord.com/api/webhooks/typed']);
});

test('nothing typed and nothing saved fails without a request', async () => {
  const tested: string[] = [];
  assert.equal((await api(undefined, tested).validateDiscord()).success, false);
  assert.deepEqual(tested, []);
});
