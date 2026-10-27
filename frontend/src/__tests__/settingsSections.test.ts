import assert from 'node:assert';
import test from 'node:test';
import { DEFAULT_DISCORD_MESSAGE_TEMPLATE } from '../lib/discordTemplate';
import { changedKeys, savedValues, sectionErrors, sectionFromSearch, sectionInput, sectionStatus, visibleSections } from '../settings/sections';

const laptop = visibleSections('laptop');
const workspace = visibleSections('workspace');

test('the rail has three groups, and a workspace DOCK has no calendar', () => {
  assert.deepStrictEqual([...new Set(laptop.map((section) => section.group))], ['Preferences', 'Integrations', 'Agents']);
  assert.ok(laptop.some((section) => section.id === 'calendar'));
  assert.ok(!workspace.some((section) => section.id === 'calendar'));
});

test('Claude account sits in Agents on a workspace DOCK, which runs the turns; a laptop DOCK has none', () => {
  assert.deepStrictEqual(workspace.filter((section) => section.group === 'Agents').map((section) => section.id), ['tokens', 'demo', 'claude']);
  assert.ok(!laptop.some((section) => section.id === 'claude'));
  assert.strictEqual(sectionFromSearch('?section=claude', workspace), 'claude');
});

test('?section= opens a section, the Google redirect opens Calendar, anything else opens General', () => {
  assert.strictEqual(sectionFromSearch('?section=discord', laptop), 'discord');
  assert.strictEqual(sectionFromSearch('?google=connected', laptop), 'calendar');
  assert.strictEqual(sectionFromSearch('?google=failed&reason=access-denied', laptop), 'calendar');
  assert.strictEqual(sectionFromSearch('?section=calendar', workspace), 'general');
  assert.strictEqual(sectionFromSearch('?section=nope', laptop), 'general');
  assert.strictEqual(sectionFromSearch('', laptop), 'general');
});

test('saved values start secrets blank and show a whole-minute interval in minutes', () => {
  const saved = savedValues({ serviceHealthRefreshSeconds: 120, hasJiraApiToken: true, jiraUrl: 'x.atlassian.net' });
  assert.deepStrictEqual(saved.general, { healthValue: '2', healthUnit: 'minutes' });
  assert.strictEqual(saved.jira.jiraApiToken, '');
  assert.strictEqual(saved.discord.discordMessageTemplate, DEFAULT_DISCORD_MESSAGE_TEMPLATE);
  assert.deepStrictEqual(savedValues({ serviceHealthRefreshSeconds: 90 }).general, { healthValue: '90', healthUnit: 'seconds' });
});

test('a section sends only its own keys, and General sends seconds', () => {
  assert.deepStrictEqual(sectionInput('general', { healthValue: '3', healthUnit: 'minutes' }), { serviceHealthRefreshSeconds: 180 });
  assert.deepStrictEqual(Object.keys(sectionInput('jira', savedValues({}).jira)), ['jiraUrl', 'jiraEmail', 'jiraApiToken', 'jiraProjectKeys']);
});

test('errors belong to their own section only', () => {
  const values = savedValues({});
  assert.strictEqual(sectionErrors('general', { healthValue: '3', healthUnit: 'seconds' }).length, 1);
  assert.strictEqual(sectionErrors('discord', { ...values.discord, discordMessageTemplate: '{{foo}}' }).length, 1);
  assert.deepStrictEqual(sectionErrors('jira', values.jira), [], 'a bad Discord template does not block Jira');
});

test('changed keys compare the draft with the saved values', () => {
  const saved = savedValues({ jiraUrl: 'a' }).jira;
  assert.deepStrictEqual(changedKeys(saved, saved), []);
  assert.deepStrictEqual(changedKeys(saved, { ...saved, jiraUrl: 'b', jiraApiToken: 'new' }), ['jiraUrl', 'jiraApiToken']);
});

test('a rail dot comes from saved data, never from what is still being typed', () => {
  const extra = { dirty: false, tests: {}, demoStorage: false };
  assert.strictEqual(sectionStatus('jira', { jiraUrl: 'a', jiraEmail: 'b' }, extra), 'off', 'no saved token is not connected');
  assert.strictEqual(sectionStatus('jira', { jiraUrl: 'a', jiraEmail: 'b', hasJiraApiToken: true }, extra), 'ok');
  assert.strictEqual(sectionStatus('jira', { hasJiraApiToken: true, jiraUrl: 'a', jiraEmail: 'b' }, { ...extra, tests: { jira: { ok: false, message: '401' } } }), 'bad');
  assert.strictEqual(sectionStatus('discord', {}, { ...extra, dirty: true }), 'unsaved');
  assert.strictEqual(sectionStatus('general', {}, extra), null, 'General has nothing to be connected');
  assert.strictEqual(sectionStatus('calendar', { googleCalendarConnected: true, googleCalendarError: 'revoked' }, extra), 'bad');
  assert.strictEqual(sectionStatus('demo', {}, { ...extra, demoStorage: true }), 'ok');
});
