/**
 * The Discord Gateway: one websocket the bot keeps open, so Discord pushes each new message or thread change to DOCK
 * instead of DOCK reading the channels on a timer. It says hello, identifies (or resumes after a drop), beats, and
 * hands every dispatch to the reader. A dropped connection resumes, so the events missed meanwhile are sent again;
 * when Discord refuses the resume, the next READY tells the reader to read everything once.
 */

export const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
/** Guilds, guild messages and message content: the threads, their messages and what the messages say. */
export const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);
/** Close codes after which trying again cannot help: a bad token, bad intents, or a gateway version or shard error. */
const FATAL = new Map([
  [4004, 'Discord refused the bot token'],
  [4010, 'Discord refused the gateway shard'],
  [4011, 'Discord wants the bot sharded'],
  [4012, 'Discord refused the gateway version'],
  [4013, 'Discord refused the gateway intents'],
  [4014, 'Turn on the Message Content intent for the bot in the Discord developer portal'],
]);
const MAX_BACKOFF_MS = 60_000;

const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 } as const;

export interface GatewaySocket {
  send(data: string): void;
  close(code: number): void;
}

export interface GatewayDeps {
  /** Opens a socket that calls back with each text frame and once when it closes. */
  connect(url: string, onMessage: (data: string) => void, onClose: (code: number) => void): GatewaySocket;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** A message or thread event, for the reader. */
  onEvent(type: string, data: unknown): void;
  /** Connected. `resumed` is false for a new session, which may have missed events. */
  onReady(resumed: boolean): void;
}

interface Payload { op: number; d?: unknown; s?: number | null; t?: string | null }

export class DiscordGateway {
  /** live: connected; connecting: on its way; stopped: off, with `error` when Discord ended it for good. */
  state: 'stopped' | 'connecting' | 'live' = 'stopped';
  error: string | null = null;
  private token: string | null = null;
  private socket: GatewaySocket | null = null;
  private beat: unknown = null;
  private retry: unknown = null;
  private acked = true;
  private seq: number | null = null;
  private session: { id: string; url: string } | null = null;
  private failures = 0;

  constructor(private readonly deps: GatewayDeps) {}

  get live() {
    return this.state === 'live';
  }

  /** Keeps the gateway in step with the saved token: off without one, restarted when it changes. A refused token stays off. */
  ensure(token: string | null) {
    if (token === this.token) return;
    this.stop();
    this.token = token;
    this.error = null;
    if (token) this.open(false);
  }

  stop() {
    this.token = null;
    this.state = 'stopped';
    this.session = null;
    this.seq = null;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
  }

  private clearTimers() {
    if (this.beat) this.deps.clearTimer(this.beat);
    if (this.retry) this.deps.clearTimer(this.retry);
    this.beat = null;
    this.retry = null;
  }

  private open(resume: boolean) {
    this.state = 'connecting';
    const url = resume && this.session ? `${this.session.url}/?v=10&encoding=json` : GATEWAY_URL;
    if (!resume) {
      this.session = null;
      this.seq = null;
    }
    const socket = this.deps.connect(url, (data) => { if (this.socket === socket) this.handle(JSON.parse(data) as Payload); }, (code) => { if (this.socket === socket) this.closed(code); });
    this.socket = socket;
  }

  private send(payload: Payload) {
    this.socket?.send(JSON.stringify(payload));
  }

  private handle(payload: Payload) {
    if (typeof payload.s === 'number') this.seq = payload.s;
    if (payload.op === OP.HELLO) {
      const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
      this.acked = true;
      if (this.beat) this.deps.clearTimer(this.beat);
      this.beat = this.deps.setTimer(() => this.heartbeat(interval), interval);
      if (this.session) this.send({ op: OP.RESUME, d: { token: this.token, session_id: this.session.id, seq: this.seq } });
      else this.send({ op: OP.IDENTIFY, d: { token: this.token, intents: INTENTS, properties: { os: 'linux', browser: 'dock', device: 'dock' } } });
    } else if (payload.op === OP.HEARTBEAT_ACK) {
      this.acked = true;
    } else if (payload.op === OP.HEARTBEAT) {
      this.send({ op: OP.HEARTBEAT, d: this.seq });
    } else if (payload.op === OP.RECONNECT) {
      this.socket?.close(4000);
    } else if (payload.op === OP.INVALID_SESSION) {
      if (!payload.d) this.session = null;
      this.socket?.close(4000);
    } else if (payload.op === OP.DISPATCH && payload.t === 'READY') {
      const ready = payload.d as { session_id: string; resume_gateway_url: string };
      this.session = { id: ready.session_id, url: ready.resume_gateway_url };
      this.connected(false);
    } else if (payload.op === OP.DISPATCH && payload.t === 'RESUMED') {
      this.connected(true);
    } else if (payload.op === OP.DISPATCH && payload.t) {
      this.deps.onEvent(payload.t, payload.d);
    }
  }

  private connected(resumed: boolean) {
    this.state = 'live';
    this.failures = 0;
    this.deps.onReady(resumed);
  }

  /** A beat Discord did not answer means the connection is dead though still open: close it and resume. */
  private heartbeat(interval: number) {
    if (!this.acked) {
      this.socket?.close(4000);
      return;
    }
    this.acked = false;
    this.send({ op: OP.HEARTBEAT, d: this.seq });
    this.beat = this.deps.setTimer(() => this.heartbeat(interval), interval);
  }

  private closed(code: number) {
    this.clearTimers();
    this.socket = null;
    if (!this.token) return;
    const fatal = FATAL.get(code);
    if (fatal) {
      this.state = 'stopped';
      this.error = fatal;
      this.session = null;
      return;
    }
    // A bad sequence or a timed out session cannot be resumed.
    if (code === 4007 || code === 4009) this.session = null;
    this.state = 'connecting';
    this.failures += 1;
    const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.failures - 1));
    this.retry = this.deps.setTimer(() => { this.retry = null; this.open(Boolean(this.session)); }, wait);
  }
}
