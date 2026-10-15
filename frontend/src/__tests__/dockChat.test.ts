import assert from 'node:assert';
import test from 'node:test';
import {
  BRIDGE_OFFLINE, balloonText, isImageAttachment, isStopping, isTurnInProgress, machineCapabilities, machineNames, machineOf, machineOnline, mergeMessages, newestAssistantId, oldestId, pollCursor, pollInterval, relativeTime, sendBlocker, sessionTurnOptions, tabLabel, ticketBalloons,
  type ChatMachine, type ChatMessage,
} from '../chat/messages';
import {
  clampDrawerHeight, closeTab, initialChatState, markSeen, openSession, parseChatState, setActive, setDrawerHeight, setMode,
  type ChatState,
} from '../chat/store';

const message = (id: number, role = 'assistant', state = 'done', text = `m${id}`, sessionId = 's1'): ChatMessage => ({ id, sessionId, role, text, state, at: '2026-10-08T10:00:00.000Z' });

test('chat messages merge by id without duplicates, in ascending order', () => {
  const first = [message(3), message(4)];
  const merged = mergeMessages(first, [message(4), message(5), message(1)]);
  assert.deepStrictEqual(merged.map((item) => item.id), [1, 3, 4, 5]);
  assert.strictEqual(mergeMessages(first, []), first, 'an empty poll keeps the same array, so nothing re-renders');
});

test('chat messages merge takes the incoming copy and keeps unconfirmed messages last', () => {
  const sent = message(-10, 'user', 'queued', 'hello');
  const merged = mergeMessages([message(7, 'user', 'queued'), sent], [message(7, 'user', 'done'), message(8)]);
  assert.deepStrictEqual(merged.map((item) => [item.id, item.state]), [[7, 'done'], [8, 'done'], [-10, 'queued']]);
  const confirmed = mergeMessages(merged.filter((item) => item.id !== sent.id), [message(9, 'user', 'queued', 'hello')]);
  assert.deepStrictEqual(confirmed.map((item) => item.id), [7, 8, 9]);
});

test('chat poll cursor follows the newest id and steps back for a turn whose end was missed', () => {
  assert.strictEqual(pollCursor([]), undefined);
  assert.strictEqual(pollCursor([message(-5, 'user', 'queued')]), undefined);
  assert.strictEqual(pollCursor([message(2), message(6)]), 6);
  const open = [message(2), message(6, 'user', 'taken'), message(7, 'tool')];
  assert.strictEqual(pollCursor(open, 'running'), 7, 'while the turn runs only new lines are asked for');
  assert.strictEqual(pollCursor(open, 'idle'), 5, 'once the session is idle the open message is fetched again');
  assert.strictEqual(oldestId([message(-1, 'user'), message(4), message(9)]), 4);
});

test('chat turn state: progress, polling speed and why sending is off', () => {
  assert.strictEqual(isTurnInProgress('idle', [message(1)]), false);
  assert.strictEqual(isTurnInProgress('queued', []), true);
  assert.strictEqual(isTurnInProgress('running', []), true);
  assert.strictEqual(isTurnInProgress('idle', [message(3, 'user', 'taken')]), true);
  assert.strictEqual(isTurnInProgress('error', [message(3, 'user', 'failed')]), false);
  assert.deepStrictEqual([pollInterval(true), pollInterval(false)], [1000, 10000]);

  assert.strictEqual(sendBlocker({ source: 'dock', busy: false, bridgeOnline: true }), null);
  assert.match(sendBlocker({ source: 'cli', busy: false, bridgeOnline: true }) || '', /read-only/);
  assert.strictEqual(sendBlocker({ source: 'dock', busy: false, bridgeOnline: false }), BRIDGE_OFFLINE);
  assert.strictEqual(BRIDGE_OFFLINE, 'The laptop bridge is offline. Start it with: node dock-chat.cjs run');
  assert.match(sendBlocker({ source: 'dock', busy: true, bridgeOnline: true }) || '', /still working/);
  assert.strictEqual(sendBlocker({ source: 'dock', busy: false }), null, 'an unknown bridge state does not block');
});

test('machines: the first session machine, per-machine online state and the offline reason', () => {
  const both: ChatMachine[] = [{ name: 'laptop', online: false, lastSeenAt: '2026-10-08T09:00:00.000Z' }, { name: 'workspace', online: true, lastSeenAt: '2026-10-08T09:59:50.000Z' }];
  const now = Date.parse('2026-10-08T10:00:00.000Z');

  assert.deepStrictEqual(machineNames(both), ['laptop', 'workspace']);
  assert.deepStrictEqual([machineNames(undefined), machineNames(null), machineNames([])], [['laptop'], ['laptop'], ['laptop']], 'no machine list means only the laptop');

  assert.deepStrictEqual([machineOnline(both, 'laptop'), machineOnline(both, 'workspace'), machineOnline(both, 'other')], [false, true, false]);
  assert.strictEqual(machineOnline(undefined, 'laptop', true), true, 'without a machine list the aggregate answers');
  assert.strictEqual(machineOnline([], 'laptop'), undefined);
  assert.deepStrictEqual([machineOf({ machine: 'workspace' }), machineOf({ machine: null }), machineOf({}), machineOf(undefined)], ['workspace', 'laptop', 'laptop', 'laptop']);

  assert.strictEqual(sendBlocker({ source: 'dock', busy: false, bridgeOnline: false, machine: 'laptop', lastSeenAt: both[0].lastSeenAt, now }), 'laptop is offline. Last seen 1 h ago. Start it with: node dock-chat.cjs run');
  assert.strictEqual(sendBlocker({ source: 'dock', busy: false, bridgeOnline: false, machine: 'workspace', now }), 'workspace is offline. Start it, then send.');
  assert.strictEqual(sendBlocker({ source: 'dock', busy: false, bridgeOnline: machineOnline(both, 'workspace'), machine: 'workspace', now }), null, 'workspace is up while the laptop is down');
  assert.match(sendBlocker({ source: 'cli', busy: false, bridgeOnline: false, machine: 'laptop', now }) || '', /read-only/);
  assert.strictEqual(sendBlocker({ source: 'dock', busy: false, bridgeOnline: false, machine: 'workspace', machineHasToken: false, lastSeenAt: both[0].lastSeenAt, now }), 'workspace has no ingest token. Create one in Settings before anything can answer.', 'a machine without a token cannot be told to start');
  assert.strictEqual(sendBlocker({ source: 'dock', busy: false, bridgeOnline: false, machine: 'workspace', machineHasToken: true, now }), 'workspace is offline. Start it, then send.', 'a listed machine that is offline keeps the old text');
});

test('chat tabs: the machine joins the label only when more than one machine exists', () => {
  const untitled = { title: '', ticketKey: null, machine: 'workspace' };
  assert.strictEqual(tabLabel(untitled, false), 'New session');
  assert.strictEqual(tabLabel(untitled, true), 'New session · workspace');
  assert.strictEqual(tabLabel({ title: '', machine: null }, true), 'New session · laptop');
  assert.strictEqual(tabLabel({ title: 'Fix login', ticketKey: 'QRD-1', machine: 'laptop' }, true), 'Fix login · laptop');
  assert.strictEqual(tabLabel({ title: '', ticketKey: 'QRD-1' }, false), 'QRD-1');
  assert.strictEqual(tabLabel(undefined, true), 'New session', 'a tab whose session is not loaded yet has no machine to show');
});

test('chat balloons: one short line per ticket from its newest assistant message', () => {
  const long = 'x'.repeat(90);
  assert.strictEqual(balloonText('  two\n\nlines  '), 'two lines');
  assert.strictEqual(balloonText(long), `${'x'.repeat(70)}…`);
  const balloons = ticketBalloons(
    [message(4, 'assistant', 'done', 'older', 'a'), message(9, 'assistant', 'done', 'newer', 'b'), message(5, 'assistant', 'done', 'no ticket', 'c'), message(6, 'assistant', 'done', 'gone', 'z')],
    [{ id: 'a', ticketKey: 'QRD-1' }, { id: 'b', ticketKey: 'QRD-1' }, { id: 'c', ticketKey: null }],
  );
  assert.deepStrictEqual(balloons, [{ key: 'QRD-1', sessionId: 'b', text: 'newer' }]);
  assert.strictEqual(newestAssistantId([message(3), message(8, 'tool'), message(5)]), 5);
});

test('chat relative time', () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z');
  assert.strictEqual(relativeTime('2026-10-08T11:59:30.000Z', now), 'just now');
  assert.strictEqual(relativeTime('2026-10-08T11:15:00.000Z', now), '45 min ago');
  assert.strictEqual(relativeTime('2026-10-08T07:00:00.000Z', now), '5 h ago');
  assert.strictEqual(relativeTime('2026-10-01T12:00:00.000Z', now), '7 d ago');
});

test('chat tabs: opening a session adds one tab, activates it and opens the chat', () => {
  const opened = openSession(initialChatState, 'a');
  assert.deepStrictEqual([opened.mode, opened.tabs, opened.active], ['float', ['a'], 'a']);
  const second = openSession(opened, 'b');
  const again = openSession(second, 'a');
  assert.deepStrictEqual([again.tabs, again.active], [['a', 'b'], 'a'], 'opening a session twice does not duplicate its tab');

  const drawer = setMode(again, 'drawer');
  const closed = setMode(drawer, 'closed');
  assert.deepStrictEqual([closed.mode, closed.openMode], ['closed', 'drawer']);
  assert.strictEqual(openSession(closed, 'c').mode, 'drawer', 'the chat reopens in the shape it had');
  assert.strictEqual(setMode(drawer, 'drawer'), drawer);
});

test('chat tabs: closing a tab moves to its neighbour and forgets what was read', () => {
  let state: ChatState = ['a', 'b', 'c'].reduce(openSession, initialChatState);
  state = markSeen(setActive(state, 'b'), 'b', 12);
  assert.strictEqual(state.active, 'b');
  const closed = closeTab(state, 'b');
  assert.deepStrictEqual([closed.tabs, closed.active, closed.lastSeen], [['a', 'c'], 'c', {}]);
  assert.strictEqual(closeTab(closed, 'c').active, 'a');
  assert.strictEqual(closeTab(closeTab(closed, 'c'), 'a').active, null);
  assert.strictEqual(closeTab(state, 'a').active, 'b', 'closing another tab keeps the active one');
  assert.strictEqual(closeTab(state, 'missing'), state);
  assert.strictEqual(setActive(state, 'missing'), state);
});

test('chat tabs: a message counts as read once, and only forward', () => {
  const state = openSession(initialChatState, 'a');
  const seen = markSeen(state, 'a', 7);
  assert.strictEqual(seen.lastSeen.a, 7);
  assert.strictEqual(markSeen(seen, 'a', 5), seen);
  assert.strictEqual(markSeen(seen, 'a', 7), seen);
  assert.strictEqual(markSeen(seen, 'not-a-tab', 9), seen);
});

test('chat drawer height stays between 200 px and 80% of the viewport', () => {
  assert.strictEqual(clampDrawerHeight(50, 1000), 200);
  assert.strictEqual(clampDrawerHeight(950, 1000), 800);
  assert.strictEqual(clampDrawerHeight(420.4, 1000), 420);
  assert.strictEqual(clampDrawerHeight(400, 200), 200, 'a very short window still gets the minimum');
  assert.strictEqual(setDrawerHeight(initialChatState, 5000, 1000).drawerHeight, 800);
  assert.strictEqual(setDrawerHeight(initialChatState, initialChatState.drawerHeight, 1000), initialChatState);
});

test('chat state survives a reload and ignores a broken or foreign value', () => {
  const state = markSeen(setMode(['a', 'b'].reduce(openSession, initialChatState), 'drawer'), 'b', 4);
  assert.deepStrictEqual(parseChatState(JSON.stringify(state)), state);
  assert.deepStrictEqual(parseChatState('not json'), initialChatState);
  assert.deepStrictEqual(parseChatState(null), initialChatState);
  const repaired = parseChatState(JSON.stringify({ mode: 'sideways', tabs: ['a', 'a', 7, ''], active: 'gone', drawerHeight: 3, lastSeen: { a: 2, gone: 9, b: 'x' } }));
  assert.deepStrictEqual(repaired, { ...initialChatState, tabs: ['a'], active: 'a', lastSeen: { a: 2 } });
});

test('machine capabilities: an old or unknown machine reports none, so no new control shows', () => {
  const machines: ChatMachine[] = [{ name: 'laptop', online: true }, { name: 'workspace', online: true, capabilities: ['interactive', 'stop'] }, { name: 'odd', online: true, capabilities: null }];
  assert.deepStrictEqual(machineCapabilities(machines, 'workspace'), ['interactive', 'stop']);
  assert.deepStrictEqual(machineCapabilities(machines, 'laptop'), []);
  assert.deepStrictEqual(machineCapabilities(machines, 'odd'), []);
  assert.deepStrictEqual(machineCapabilities(machines, 'missing'), []);
  assert.deepStrictEqual(machineCapabilities(undefined, 'laptop'), []);
});

test('session turn options: nothing stored means no options', () => {
  assert.strictEqual(sessionTurnOptions(undefined), null);
  assert.strictEqual(sessionTurnOptions({ options: null }), null);
  assert.strictEqual(sessionTurnOptions({ options: { model: null, effort: null, permissionMode: null, fast: null } }), null);
  assert.deepStrictEqual(sessionTurnOptions({ options: { model: 'sonnet', effort: 'low', permissionMode: undefined, fast: null } }), { model: 'sonnet', effort: 'low', permissionMode: null, fast: null });
});

test('stopping shows from the tap until the session leaves queued or running', () => {
  assert.strictEqual(isStopping(true, 'running'), true);
  assert.strictEqual(isStopping(true, 'queued'), true);
  assert.strictEqual(isStopping(true, 'idle'), false);
  assert.strictEqual(isStopping(true, 'error'), false);
  assert.strictEqual(isStopping(false, 'running'), false);
});

test('attachments: only a stored image type is shown as a thumbnail', () => {
  assert.strictEqual(isImageAttachment({ id: 'a', name: 'x.png', mime: 'image/png', size: 3, state: 'fetched' }), true);
  assert.strictEqual(isImageAttachment({ id: 'a', name: 'x.png', mime: 'image/png', size: 3, state: 'deleted' }), false);
  assert.strictEqual(isImageAttachment({ id: 'a', name: 'x.svg', mime: 'image/svg+xml', size: 3, state: 'attached' }), false);
  assert.strictEqual(isImageAttachment({ id: 'a', name: 'x.pdf', mime: 'application/pdf', size: 3, state: 'attached' }), false);
});
