import assert from 'node:assert';
import test from 'node:test';
import { StorageAPI } from '../datasources/StorageAPI';
import { parseSetupArgs, runSetup, validateGithub, validateJira, validatePin } from '../cli/setup';

const ok = async () => ({ ok: true, status: 200 });
const status = (code: number) => async () => ({ ok: false, status: code });

function memoryApi(hasPin = false) {
  const writes: Array<[string, string]> = [];
  const pins: string[] = [];
  const storage = {
    getSettings: async () => [],
    hasMasterPin: async () => hasPin,
    upsertSetting: async (key: string, value: string) => { writes.push([key, value]); },
    setMasterPin: async (pin: string) => { pins.push(pin); },
  };
  return { api: new StorageAPI(storage as any), writes, pins };
}

test('parseSetupArgs reads flags, inline values and DOCK_SETUP_* variables, and flags win', () => {
  const values = parseSetupArgs(
    ['--jira-url', 'https://acme.atlassian.net/', '--jira-email=me@acme.io', '--pin', '1234'],
    { DOCK_SETUP_JIRA_URL: 'old.atlassian.net', DOCK_SETUP_GITHUB_TOKEN: 'ghp_env' },
  );
  assert.deepStrictEqual(values, { jiraUrl: 'acme.atlassian.net', jiraEmail: 'me@acme.io', pin: '1234', githubToken: 'ghp_env' });
});

test('parseSetupArgs rejects an unknown flag and a flag without a value', () => {
  assert.throws(() => parseSetupArgs(['--discord-token', 'x']), /Unknown option --discord-token/);
  assert.throws(() => parseSetupArgs(['--pin']), /--pin needs a value/);
});

test('validateJira calls /rest/api/3/myself with basic auth and reports a rejection without the token', async () => {
  const seen: Array<{ url: string; auth: string }> = [];
  const fetchFn = async (url: string, init: { headers: Record<string, string> }) => { seen.push({ url, auth: init.headers.Authorization }); return { ok: true, status: 200 }; };
  assert.strictEqual(await validateJira({ jiraUrl: 'acme.atlassian.net', jiraEmail: 'me@acme.io', jiraToken: 'secret' }, fetchFn), null);
  assert.strictEqual(seen[0].url, 'https://acme.atlassian.net/rest/api/3/myself');
  assert.strictEqual(seen[0].auth, `Basic ${Buffer.from('me@acme.io:secret').toString('base64')}`);
  const message = await validateJira({ jiraUrl: 'acme.atlassian.net', jiraEmail: 'me@acme.io', jiraToken: 'secret' }, status(401));
  assert.match(message ?? '', /Jira rejected the credentials/);
  assert.ok(!message?.includes('secret'));
});

test('validateGithub calls /user with the bearer token and reports an unreachable host', async () => {
  const seen: Array<{ url: string; auth: string }> = [];
  const fetchFn = async (url: string, init: { headers: Record<string, string> }) => { seen.push({ url, auth: init.headers.Authorization }); return { ok: true, status: 200 }; };
  assert.strictEqual(await validateGithub({ githubToken: 'ghp_x' }, fetchFn), null);
  assert.deepStrictEqual(seen, [{ url: 'https://api.github.com/user', auth: 'Bearer ghp_x' }]);
  const failing = async () => { throw new Error('offline'); };
  assert.strictEqual(await validateGithub({ githubToken: 'ghp_x' }, failing), 'Could not reach GitHub.');
});

test('the PIN is 4 to 6 digits', () => {
  assert.strictEqual(validatePin('1234'), null);
  assert.strictEqual(validatePin('123456'), null);
  assert.ok(validatePin('123'));
  assert.ok(validatePin('1234567'));
  assert.ok(validatePin('12a4'));
});

test('runSetup writes Jira, GitHub and the PIN through the settings service', async () => {
  const { api, writes, pins } = memoryApi();
  const result = await runSetup(api, { jiraUrl: 'acme.atlassian.net', jiraEmail: 'me@acme.io', jiraToken: 'jt', githubToken: 'gt', pin: '2468' }, ok);
  assert.deepStrictEqual(result, { saved: ['Jira', 'GitHub', 'PIN'], errors: [] });
  assert.deepStrictEqual(Object.fromEntries(writes), { jiraUrl: 'acme.atlassian.net', jiraEmail: 'me@acme.io', jiraApiToken: 'jt', githubToken: 'gt' });
  assert.deepStrictEqual(pins, ['2468']);
});

test('runSetup writes nothing when one check fails', async () => {
  const { api, writes, pins } = memoryApi();
  const fetchFn = async (url: string) => (url.includes('github') ? { ok: false, status: 401 } : { ok: true, status: 200 });
  const result = await runSetup(api, { jiraUrl: 'acme.atlassian.net', jiraEmail: 'me@acme.io', jiraToken: 'jt', githubToken: 'bad', pin: '2468' }, fetchFn);
  assert.deepStrictEqual(result.saved, []);
  assert.match(result.errors[0], /GitHub rejected the credentials/);
  assert.deepStrictEqual(writes, []);
  assert.deepStrictEqual(pins, []);
});

test('runSetup needs all three Jira values and never replaces an existing PIN', async () => {
  const partial = await runSetup(memoryApi().api, { jiraUrl: 'acme.atlassian.net' }, ok);
  assert.match(partial.errors[0], /URL, an email and an API token together/);
  const { api, pins } = memoryApi(true);
  const result = await runSetup(api, { pin: '2468' }, ok);
  assert.match(result.errors[0], /already set/);
  assert.deepStrictEqual(pins, []);
});
