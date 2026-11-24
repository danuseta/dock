import assert from 'node:assert';
import test from 'node:test';
import { DEFAULT_DISCORD_MESSAGE_TEMPLATE, renderPrTag } from '../lib/discordTemplate';
import { changedKeys, savedValues, sectionErrors, sectionFromSearch, sectionInput, sectionStatus, visibleSections } from '../settings/sections';

const laptop = visibleSections('laptop');
const workspace = visibleSections('workspace');

test('the rail has four groups, and a workspace DOCK has no calendar', () => {
  assert.deepStrictEqual([...new Set(laptop.map((section) => section.group))], ['You', 'Connections', 'Automation', 'Messages & plugins']);
  assert.ok(laptop.some((section) => section.id === 'calendar'));
  assert.ok(!workspace.some((section) => section.id === 'calendar'));
});

test('Planning flow, Sous flow and Judge sit in Automation on a workspace DOCK, which runs the turns and Planning; a laptop DOCK has none of them', () => {
  assert.deepStrictEqual(workspace.filter((section) => section.group === 'Automation').map((section) => section.id), ['review', 'planflow', 'sousflow', 'judge']);
  assert.ok(!laptop.some((section) => section.id === 'claude' || section.id === 'planflow' || section.id === 'sousflow' || section.id === 'judge'));
  assert.strictEqual(sectionFromSearch('?section=sousflow', workspace), 'sousflow');
  assert.strictEqual(sectionFromSearch('?section=claude', workspace), 'claude');
  assert.strictEqual(sectionFromSearch('?section=planflow', workspace), 'planflow');
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
  assert.strictEqual(saved.messages.discordMessageTemplate, DEFAULT_DISCORD_MESSAGE_TEMPLATE);
  assert.deepStrictEqual(savedValues({ serviceHealthRefreshSeconds: 90 }).general, { healthValue: '90', healthUnit: 'seconds' });
});

test('a section sends only its own keys, and General sends seconds', () => {
  assert.deepStrictEqual(sectionInput('general', { healthValue: '3', healthUnit: 'minutes' }), { serviceHealthRefreshSeconds: 180 });
  assert.deepStrictEqual(Object.keys(sectionInput('jira', savedValues({}).jira)), ['jiraUrl', 'jiraEmail', 'jiraApiToken', 'jiraProjectKeys', 'planningConfluenceParent', 'planningPlanner']);
});

test('the reviewer tag starts on with the default message and role, and a bad field blocks the save', () => {
  const messages = savedValues({}).messages;
  assert.deepStrictEqual([messages.prTagEnabled, messages.prTagTemplate, messages.prTagRole], ['true', '@{{role}} {{slots}} mas mas, thanks', 'ITteam']);
  assert.strictEqual(savedValues({ prTagEnabled: false }).messages.prTagEnabled, 'false');
  assert.deepStrictEqual(sectionErrors('messages', messages), []);
  assert.match(sectionErrors('messages', { ...messages, prTagTemplate: '@{{role}} {{ticketKey}}' })[0], /Unsupported reviewer tag field/);
  assert.strictEqual(renderPrTag(messages.prTagTemplate, '@QA', '-1'), '@QA -1 mas mas, thanks');
  assert.ok(['prTagEnabled', 'prTagTemplate', 'prTagRole'].every((key) => key in sectionInput('messages', messages)));
});

test('errors belong to their own section only', () => {
  const values = savedValues({});
  assert.strictEqual(sectionErrors('general', { healthValue: '3', healthUnit: 'seconds' }).length, 1);
  assert.strictEqual(sectionErrors('messages', { ...values.messages, discordMessageTemplate: '{{foo}}' }).length, 1);
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
  assert.strictEqual(sectionStatus('plugins', {}, { ...extra, demoStorage: true }), 'ok');
});

test('the Plugins draft starts from the resolved choices and a local folder needs an absolute path', () => {
  assert.deepStrictEqual(savedValues({ storagePlugin: 'local', voicePlugin: 'elevenlabs', storageLocalDir: '/srv/demo' }).plugins, { storagePlugin: 'local', voicePlugin: 'elevenlabs', storageLocalDir: '/srv/demo' });
  assert.deepStrictEqual(sectionInput('plugins', { storagePlugin: 'none', voicePlugin: 'none', storageLocalDir: '' }), { storagePlugin: 'none', voicePlugin: 'none', storageLocalDir: '' });
  assert.deepStrictEqual(sectionErrors('plugins', { storagePlugin: 'local', voicePlugin: 'none', storageLocalDir: 'demo' }), ['The local folder is an absolute path.']);
  assert.deepStrictEqual(sectionErrors('plugins', { storagePlugin: 'local', voicePlugin: 'none', storageLocalDir: 'C:/demo' }), []);
  assert.deepStrictEqual(sectionErrors('plugins', { storagePlugin: 's3', voicePlugin: 'none', storageLocalDir: 'demo' }), []);
});
