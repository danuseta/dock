import assert from 'node:assert';
import test from 'node:test';
import { DEFAULT_NOTIFICATION_PREFS, EventPush, NOTIFICATION_SOUNDS, parseNotificationPrefs, validateNotificationPrefs, type NotificationPrefs } from '../integrations/notification-prefs';
import { discordPostNotice, runDoneNotice, stalledNotice, turnDoneNotice } from '../integrations/push-notices';

test('nothing saved means every event on at volume 0.6, and there are ten sounds', () => {
  const prefs = parseNotificationPrefs(null);
  assert.deepStrictEqual(prefs, DEFAULT_NOTIFICATION_PREFS);
  assert.strictEqual(prefs.volume, 0.6);
  assert.ok(Object.values(prefs.events).every((event) => event.enabled && NOTIFICATION_SOUNDS.includes(event.sound as typeof NOTIFICATION_SOUNDS[number])));
  assert.strictEqual(new Set(NOTIFICATION_SOUNDS).size, 10);
});

test('a saved value is read back; a malformed part falls back alone', () => {
  const saved = JSON.stringify({ volume: 0.2, events: { sessionDone: { enabled: false, sound: 'pluck_001' }, needsYou: { enabled: 'yes', sound: 'nope' } } });
  const prefs = parseNotificationPrefs(saved);
  assert.deepStrictEqual(prefs.events.sessionDone, { enabled: false, sound: 'pluck_001' });
  assert.deepStrictEqual(prefs.events.needsYou, DEFAULT_NOTIFICATION_PREFS.events.needsYou);
  assert.deepStrictEqual(prefs.events.discordPost, DEFAULT_NOTIFICATION_PREFS.events.discordPost);
  assert.strictEqual(prefs.volume, 0.2);
  assert.deepStrictEqual(parseNotificationPrefs('{not json'), DEFAULT_NOTIFICATION_PREFS);
  assert.strictEqual(parseNotificationPrefs(JSON.stringify({ volume: 7 })).volume, 0.6);
});

test('a save needs volume 0 to 1, every event, and a bundled sound', () => {
  const good = JSON.stringify(DEFAULT_NOTIFICATION_PREFS);
  assert.deepStrictEqual(validateNotificationPrefs(good), DEFAULT_NOTIFICATION_PREFS);
  assert.strictEqual(validateNotificationPrefs(JSON.stringify({ ...DEFAULT_NOTIFICATION_PREFS, volume: 0 })).volume, 0);
  assert.strictEqual(validateNotificationPrefs(JSON.stringify({ ...DEFAULT_NOTIFICATION_PREFS, volume: 1 })).volume, 1);
  for (const bad of [
    { ...DEFAULT_NOTIFICATION_PREFS, volume: 1.1 },
    { ...DEFAULT_NOTIFICATION_PREFS, volume: -0.1 },
    { ...DEFAULT_NOTIFICATION_PREFS, volume: '0.5' },
    { ...DEFAULT_NOTIFICATION_PREFS, events: { ...DEFAULT_NOTIFICATION_PREFS.events, discordPost: { enabled: true, sound: 'evil.wav' } } },
    { ...DEFAULT_NOTIFICATION_PREFS, events: { ...DEFAULT_NOTIFICATION_PREFS.events, needsYou: { enabled: 'on', sound: 'glass_001' } } },
    { volume: 0.5, events: { sessionDone: DEFAULT_NOTIFICATION_PREFS.events.sessionDone } },
  ]) assert.throws(() => validateNotificationPrefs(JSON.stringify(bad)));
  assert.throws(() => validateNotificationPrefs('{not json'));
});

test('a push goes out only for an event that is on', async () => {
  let prefs: NotificationPrefs = parseNotificationPrefs(null);
  const sent: string[] = [];
  const push = new EventPush({ prefs: async () => prefs, send: async (message) => { sent.push(message.title); return 1; } });
  assert.strictEqual(await push.send('discordPost', { title: 'a', body: 'b', url: '/' }), 1);
  prefs = { ...prefs, events: { ...prefs.events, discordPost: { ...prefs.events.discordPost, enabled: false } } };
  push.forget();
  assert.strictEqual(await push.send('discordPost', { title: 'c', body: 'd', url: '/' }), 0);
  assert.strictEqual(await push.send('sessionDone', { title: 'e', body: 'f', url: '/' }), 1, 'another event is unaffected');
  assert.deepStrictEqual(sent, ['a', 'e']);
});

test('a push carries its event, and the saved choice is read once per window until a save forgets it', async () => {
  let reads = 0;
  let clock = 0;
  const sent: unknown[] = [];
  const push = new EventPush({ prefs: async () => { reads += 1; return parseNotificationPrefs(null); }, send: async (message) => { sent.push(message.data); return 1; } }, () => clock);
  await push.send('needsYou', { title: 'a', body: 'b', url: '/', data: { kind: 'answer' } });
  await push.send('discordPost', { title: 'a', body: 'b', url: '/' });
  assert.deepStrictEqual(sent, [{ kind: 'answer', event: 'needsYou' }, { event: 'discordPost' }]);
  assert.strictEqual(reads, 1);
  clock = 11_000;
  await push.send('discordPost', { title: 'a', body: 'b', url: '/' });
  assert.strictEqual(reads, 2);
  push.forget();
  await push.send('discordPost', { title: 'a', body: 'b', url: '/' });
  assert.strictEqual(reads, 3);
});

test('a save that is not an object is refused as invalid settings', () => {
  for (const bad of ['null', '5', '"x"', '{not json']) assert.throws(() => validateNotificationPrefs(bad), /Invalid notification settings/);
});

test('the notices name the page they open and carry a tag the page can match', () => {
  assert.deepStrictEqual(turnDoneNotice({ sessionId: 's 1', sessionTitle: '' }), { title: 'A session finished', body: 'The agent finished its turn.', url: '/sessions?session=s%201', tag: 'done-s 1' });
  assert.strictEqual(runDoneNotice({ key: 'QRD-1', title: 'T' }).url, '/detail/QRD-1');
  assert.strictEqual(stalledNotice({ key: 'QRD-1' }).tag, 'stalled-QRD-1');
  assert.deepStrictEqual(discordPostNotice({ threadId: '1', messageId: '2', channel: 'bugs', author: 'Sam', text: 'hi' }), { title: 'bugs: Sam', body: 'hi', url: '/discord', tag: 'discord-1-2' });
});
