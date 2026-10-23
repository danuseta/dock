import assert from 'node:assert';
import test from 'node:test';
import { DiscordGateway, GATEWAY_URL, INTENTS, type GatewayDeps } from '../integrations/discord-gateway';

/** A gateway on fake sockets and timers: `server` plays Discord on the last socket opened. */
function harness() {
  const sockets: Array<{ url: string; sent: Array<{ op: number; d?: any }>; closed: number | null; message: (data: string) => void; close: (code: number) => void }> = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const events: Array<[string, unknown]> = [];
  const ready: boolean[] = [];
  const deps: GatewayDeps = {
    connect: (url, onMessage, onClose) => {
      const socket = { url, sent: [] as Array<{ op: number; d?: any }>, closed: null as number | null, message: onMessage, close: onClose };
      sockets.push(socket);
      return { send: (data) => socket.sent.push(JSON.parse(data)), close: (code) => { socket.closed = code; onClose(code); } };
    },
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (handle) => { (handle as { cleared: boolean }).cleared = true; },
    onEvent: (type, data) => { events.push([type, data]); },
    onReady: (resumed) => { ready.push(resumed); },
  };
  const gateway = new DiscordGateway(deps);
  const last = () => sockets[sockets.length - 1];
  const server = (payload: object) => last().message(JSON.stringify(payload));
  const fire = () => { const timer = timers.filter((item) => !item.cleared).pop(); assert.ok(timer, 'a timer is waiting'); timer.cleared = true; timer.fn(); };
  return { gateway, sockets, timers, events, ready, last, server, fire };
}

test('the gateway identifies with the intents, goes live on READY and hands dispatches to the reader', () => {
  const { gateway, last, server, events, ready } = harness();
  gateway.ensure('tok');
  assert.strictEqual(last().url, GATEWAY_URL);
  assert.strictEqual(gateway.state, 'connecting');
  server({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepStrictEqual(last().sent[0], { op: 2, d: { token: 'tok', intents: INTENTS, properties: { os: 'linux', browser: 'dock', device: 'dock' } } });
  server({ op: 0, s: 1, t: 'READY', d: { session_id: 'sess', resume_gateway_url: 'wss://resume.discord.gg' } });
  assert.strictEqual(gateway.live, true);
  assert.deepStrictEqual(ready, [false], 'a new session reads everything once');
  server({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: { channel_id: '2001' } });
  assert.deepStrictEqual(events, [['MESSAGE_CREATE', { channel_id: '2001' }]]);
});

test('a dropped connection resumes from the last sequence, and a beat Discord did not answer closes it', () => {
  const { gateway, sockets, last, server, ready, fire } = harness();
  gateway.ensure('tok');
  server({ op: 10, d: { heartbeat_interval: 1000 } });
  server({ op: 0, s: 7, t: 'READY', d: { session_id: 'sess', resume_gateway_url: 'wss://resume.discord.gg' } });
  fire();
  assert.deepStrictEqual(last().sent.at(-1), { op: 1, d: 7 }, 'the beat carries the last sequence');
  fire();
  assert.strictEqual(last().closed, 4000, 'no ACK since the last beat: the connection is dead');
  assert.strictEqual(gateway.state, 'connecting');
  fire();
  assert.strictEqual(sockets.length, 2);
  assert.strictEqual(last().url, 'wss://resume.discord.gg/?v=10&encoding=json');
  server({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.deepStrictEqual(last().sent[0], { op: 6, d: { token: 'tok', session_id: 'sess', seq: 7 } });
  server({ op: 0, s: 8, t: 'RESUMED' });
  assert.deepStrictEqual(ready, [false, true], 'a resumed session gets the missed events, so nothing is read again');
});

test('a refused session starts over, and a refused token stops for good until the token changes', () => {
  const { gateway, sockets, last, server, fire, timers } = harness();
  gateway.ensure('tok');
  server({ op: 10, d: { heartbeat_interval: 1000 } });
  server({ op: 0, s: 1, t: 'READY', d: { session_id: 'sess', resume_gateway_url: 'wss://resume.discord.gg' } });
  server({ op: 9, d: false });
  fire();
  assert.strictEqual(last().url, GATEWAY_URL, 'an invalid session identifies again');

  last().close(4004);
  assert.deepStrictEqual([gateway.state, gateway.error], ['stopped', 'Discord refused the bot token']);
  assert.ok(timers.every((timer) => timer.cleared), 'nothing tries again');
  gateway.ensure('tok');
  assert.strictEqual(sockets.length, 2, 'the same token stays off');
  gateway.ensure('new');
  assert.deepStrictEqual([sockets.length, gateway.error], [3, null]);
  gateway.ensure(null);
  assert.deepStrictEqual([gateway.state, last().closed], ['stopped', 1000]);
});
