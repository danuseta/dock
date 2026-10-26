import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { finishedSessions, newAttention, newDiscordPosts, pushWanted, soundForPush } from '../lib/notificationEvents';
import { noticeFromPush, useNotices } from '../lib/notices';
import { DEFAULT_NOTIFICATION_PREFS, NOTIFICATION_EVENTS, NOTIFICATION_SOUNDS, parseNotificationPrefs, prefsToValues, valuesToPrefs } from '../lib/notificationPrefs';
import { savedValues, sectionInput, visibleSections } from '../settings/sections';

const root = fileURLToPath(new URL('../..', import.meta.url));
const source = (file: string) => fs.readFileSync(path.join(root, 'src', file), 'utf8');

test('nothing saved means every event on at volume 60, and a bad part falls back alone', () => {
  assert.deepStrictEqual(parseNotificationPrefs(null), DEFAULT_NOTIFICATION_PREFS);
  assert.deepStrictEqual(parseNotificationPrefs('{not json'), DEFAULT_NOTIFICATION_PREFS);
  const prefs = parseNotificationPrefs(JSON.stringify({ volume: 2, events: { sessionDone: { enabled: false, sound: 'pluck_001' }, needsYou: { enabled: true, sound: 'evil' } } }));
  assert.strictEqual(prefs.volume, 0.6);
  assert.deepStrictEqual(prefs.events.sessionDone, { enabled: false, sound: 'pluck_001' });
  assert.deepStrictEqual(prefs.events.needsYou, DEFAULT_NOTIFICATION_PREFS.events.needsYou);
  assert.strictEqual(savedValues({}).notifications.volume, '60');
});

test('the form round-trips, and a save sends one JSON key with the volume between 0 and 1', () => {
  const prefs = { volume: 0.35, events: { ...DEFAULT_NOTIFICATION_PREFS.events, discordPost: { enabled: false, sound: 'drop_002' } } };
  assert.deepStrictEqual(valuesToPrefs(prefsToValues(prefs)), prefs);
  const input = sectionInput('notifications', savedValues({ notificationPrefs: JSON.stringify(prefs) }).notifications);
  assert.deepStrictEqual(Object.keys(input), ['notificationPrefs']);
  assert.deepStrictEqual(JSON.parse(String(input.notificationPrefs)), prefs);
  assert.strictEqual(valuesToPrefs({ ...prefsToValues(prefs), volume: '250' }).volume, 1);
});

test('the ten bundled sounds exist, each with a label, and their licence is next to them', () => {
  assert.strictEqual(NOTIFICATION_SOUNDS.length, 10);
  assert.strictEqual(new Set(NOTIFICATION_SOUNDS.map((sound) => sound.label)).size, 10);
  for (const sound of NOTIFICATION_SOUNDS) assert.ok(fs.statSync(path.join(root, 'public', 'sounds', `${sound.id}.wav`)).size > 1000, sound.id);
  const licence = fs.readFileSync(path.join(root, 'public', 'sounds', 'LICENSE.txt'), 'utf8');
  assert.ok(/Kenney/.test(licence) && /CC0 1\.0/.test(licence));
});

test('Settings has a Notifications section; its page has a toggle, a sound picker and a Preview for each event, and a volume slider', () => {
  assert.ok(visibleSections('laptop').some((section) => section.id === 'notifications'));
  assert.ok(source('pages/SettingsPage.tsx').includes("active === 'notifications'"));
  const section = source('settings/sections/NotificationsSection.tsx');
  assert.ok(section.includes('<PushCard />'), 'next to the push card');
  assert.ok(section.includes('type="range"'), 'volume slider');
  assert.ok(section.includes('NOTIFICATION_EVENTS.map'), 'one row per event');
  for (const needle of ['<Checkbox', '<Select', 'Preview', 'playSound(']) assert.ok(section.includes(needle), needle);
  assert.strictEqual(NOTIFICATION_EVENTS.length, 3);
});

test('finished sessions: the first look and a reload replay nothing; running to idle announces once', () => {
  const running = [{ id: 's1', title: 'Fix login', status: 'running' }, { id: 's2', title: 'Old', status: 'idle' }];
  const first = finishedSessions(null, [{ ...running[0], status: 'idle' }, running[1]]);
  assert.deepStrictEqual(first.events, [], 'a first look only remembers');
  const started = finishedSessions(first.seen, running);
  assert.deepStrictEqual(started.events, [], 'idle to running is not an end');
  const ended = finishedSessions(started.seen, [{ ...running[0], status: 'idle' }, running[1]]);
  assert.deepStrictEqual(ended.events.map((event) => [event.event, event.tag, event.title, event.url]), [['sessionDone', 'done-s1', 'Fix login finished', '/sessions?session=s1']]);
  assert.deepStrictEqual(finishedSessions(ended.seen, [{ ...running[0], status: 'idle' }, running[1]]).events, [], 'and not again');
});

test('attention: only stalled or waiting runs count, the first look is silent, a new one announces', () => {
  const stalled = { id: 'agent-stalled-QRD-1', type: 'AGENT_STALLED', message: 'No agent activity for 20 min', ticketKey: 'QRD-1' };
  const conflict = { id: 'c', type: 'CONFLICT', message: 'merge conflict', ticketKey: 'QRD-2' };
  const first = newAttention(null, [stalled, conflict]);
  assert.deepStrictEqual(first.events, []);
  const waiting = { id: 'agent-waiting-QRD-3', type: 'AGENT_WAITING', message: 'Which endpoint?', ticketKey: 'QRD-3' };
  const next = newAttention(first.seen, [stalled, conflict, waiting, { ...conflict, id: 'c2' }]);
  assert.deepStrictEqual(next.events.map((event) => [event.event, event.tag, event.url]), [['needsYou', 'wait-QRD-3', '/detail/QRD-3']]);
});

test('discord: every new post of someone else announces; the first look, own posts and a new thread\'s history do not', () => {
  const message = (id: string, mine = false) => ({ id, author: 'Rina', mine, text: `post ${id}` });
  const row = (id: string, ids: string[]) => ({ id, channel: 'bug-report', messages: ids.map((messageId) => message(messageId)) });
  const first = newDiscordPosts(null, [row('t1', ['1', '2'])]);
  assert.deepStrictEqual(first.events, [], 'a reload replays nothing');
  const rows = [{ ...row('t1', ['1', '2', '3', '4']), messages: [message('1'), message('2'), message('3'), message('4', true), message('5')] }, row('t2', ['7', '8', '9'])];
  const next = newDiscordPosts(first.seen, rows);
  assert.deepStrictEqual(next.events.map((event) => event.tag), ['discord-t1-3', 'discord-t1-5', 'discord-t2-9']);
  assert.strictEqual(next.events[0].title, 'bug-report: Rina');
  assert.deepStrictEqual(newDiscordPosts(next.seen, rows).events, []);
});

test('a stopped turn, a cron session and a ticket session are not announced as finished', () => {
  const before = new Map([['a', 'running'], ['b', 'running'], ['c', 'running'], ['d', 'running']]);
  const { events } = finishedSessions(before, [
    { id: 'a', title: 'A', status: 'idle', statusDetail: 'Stopped' },
    { id: 'b', title: 'B', status: 'idle', origin: 'cron' },
    { id: 'c', title: 'C', status: 'idle', ticketKey: 'QRD-1' },
    { id: 'd', title: 'D', status: 'idle', statusDetail: null, origin: 'manual' },
  ]);
  assert.deepStrictEqual(events.map((event) => event.tag), ['done-d']);
  assert.deepStrictEqual(finishedSessions(new Map([['a', 'queued']]), [{ id: 'a', title: 'A', status: 'idle', statusDetail: 'Stopped before it started' }]).events, []);
});

test('a stalled run is announced once although its message counts minutes', () => {
  const stalled = (minutes: number) => ({ id: 'agent-stalled-QRD-1', type: 'AGENT_STALLED', message: `No agent activity for ${minutes} min in code`, ticketKey: 'QRD-1' });
  const first = newAttention(null, [stalled(20)]);
  const second = newAttention(first.seen, [stalled(21)]);
  assert.deepStrictEqual(second.events, []);
  assert.deepStrictEqual(newAttention(second.seen, [stalled(22)]).events, []);
  assert.strictEqual(newAttention(newAttention(second.seen, []).seen, [stalled(5)]).events.length, 1, 'a new stall after it cleared');
});

test('a push told to a page in view plays the sound of its event, only if that event is on', () => {
  const prefs = parseNotificationPrefs(JSON.stringify({ volume: 0.3, events: { discordPost: { enabled: false, sound: 'bong_001' }, needsYou: { enabled: true, sound: 'pluck_001' } } }));
  assert.deepStrictEqual(soundForPush({ type: 'dock-push', event: 'needsYou' }, prefs), { sound: 'pluck_001', volume: 0.3 });
  for (const message of [{ type: 'dock-push', event: 'discordPost' }, { type: 'dock-push', event: 'nope' }, { type: 'other', event: 'needsYou' }, { type: 'dock-push' }, null, 'x']) assert.strictEqual(soundForPush(message, prefs), null);
});

test('a page in view shows the notification itself: the push names title, text and link, and an event turned off shows nothing', () => {
  const prefs = parseNotificationPrefs(JSON.stringify({ events: { discordPost: { enabled: false, sound: 'bong_001' } } }));
  const push = { type: 'dock-push', event: 'needsYou', title: 'QRD-7 waits on you', body: 'Keep it?', url: '/detail/QRD-7' };
  assert.deepStrictEqual(noticeFromPush(push), { title: 'QRD-7 waits on you', body: 'Keep it?', url: '/detail/QRD-7' });
  assert.deepStrictEqual(noticeFromPush({ ...push, url: 'https://evil.example' }), { title: 'QRD-7 waits on you', body: 'Keep it?', url: '/' }, 'only a link inside DOCK');
  for (const message of [{ ...push, title: '' }, { ...push, type: 'other' }, null, 'x']) assert.strictEqual(noticeFromPush(message), null);
  assert.strictEqual(pushWanted(push, prefs), true);
  assert.strictEqual(pushWanted({ ...push, event: 'discordPost' }, prefs), false);
  assert.strictEqual(pushWanted({ type: 'dock-push', title: 'A session asks' }, prefs), true, 'an ask names no event');
});

test('at most three notices stay on the page, newest last, and one can be dismissed', () => {
  for (const n of [1, 2, 3, 4]) useNotices.getState().show({ title: `n${n}`, body: '', url: '/' });
  assert.deepStrictEqual(useNotices.getState().notices.map((notice) => notice.title), ['n2', 'n3', 'n4']);
  useNotices.getState().dismiss(useNotices.getState().notices[0].id);
  assert.deepStrictEqual(useNotices.getState().notices.map((notice) => notice.title), ['n3', 'n4']);
  const layout = source('components/AppLayout.tsx');
  assert.ok(layout.includes('<NoticeToasts onNavigate={onNavigate} />'));
  assert.ok(/visibilityState === 'visible'\) showPageNotice/.test(source('lib/notificationEvents.ts')), 'in view: inside the page, not the system');
});

test('a notification is shown through the service worker and never throws out of the page', () => {
  const events = source('lib/notificationEvents.ts');
  assert.ok(events.includes('registration.showNotification('), 'the constructor throws on Android Chrome and an installed iPhone app');
  assert.ok(!events.includes('location.assign'), 'a click is handled by sw.js');
  assert.ok(/async function showNotice[\s\S]*try \{[\s\S]*\} catch/.test(events));
});

test('the backend and the page agree on the sound ids and the defaults', () => {
  const backend = fs.readFileSync(path.join(root, '..', 'backend', 'bff-graphql', 'src', 'integrations', 'notification-prefs.ts'), 'utf8');
  const sounds = [...backend.slice(backend.indexOf('NOTIFICATION_SOUNDS'), backend.indexOf('] as const', backend.indexOf('NOTIFICATION_SOUNDS'))).matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
  assert.deepStrictEqual(sounds, NOTIFICATION_SOUNDS.map((sound) => sound.id));
  const defaults = backend.slice(backend.indexOf('DEFAULT_NOTIFICATION_PREFS'));
  assert.ok(defaults.includes(`volume: ${DEFAULT_NOTIFICATION_PREFS.volume}`));
  for (const id of NOTIFICATION_EVENTS.map((event) => event.id)) {
    assert.ok(defaults.includes(`${id}: { enabled: ${DEFAULT_NOTIFICATION_PREFS.events[id].enabled}, sound: '${DEFAULT_NOTIFICATION_PREFS.events[id].sound}' }`), id);
  }
});
