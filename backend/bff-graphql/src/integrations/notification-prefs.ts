import type { PushMessage } from './push';

export const NOTIFICATION_EVENTS = ['sessionDone', 'needsYou', 'discordPost'] as const;
export type NotificationEvent = typeof NOTIFICATION_EVENTS[number];

/** The bundled sounds, by file name without .wav; the files live in frontend/public/sounds. */
export const NOTIFICATION_SOUNDS = [
  'confirmation_001', 'confirmation_002', 'confirmation_003', 'glass_001', 'glass_003',
  'bong_001', 'drop_002', 'maximize_004', 'open_001', 'pluck_001',
] as const;

export const NOTIFICATION_PREFS_KEY = 'notificationPrefs';
const PREFS_TTL_MS = 10_000;

export interface NotificationPrefs {
  volume: number;
  events: Record<NotificationEvent, { enabled: boolean; sound: string }>;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  volume: 0.6,
  events: {
    sessionDone: { enabled: true, sound: 'confirmation_001' },
    needsYou: { enabled: true, sound: 'glass_001' },
    discordPost: { enabled: true, sound: 'bong_001' },
  },
};

const isSound = (value: unknown): value is string => typeof value === 'string' && (NOTIFICATION_SOUNDS as readonly string[]).includes(value);
const isVolume = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;

/** What is saved, with a default for every missing or malformed part: a bad value never turns a notification off. */
export function parseNotificationPrefs(raw: string | null | undefined): NotificationPrefs {
  let saved: Partial<{ volume: unknown; events: Record<string, { enabled?: unknown; sound?: unknown } | undefined> }> = {};
  try { saved = JSON.parse(raw || '{}') ?? {}; } catch { /* unreadable: all defaults */ }
  const events = Object.fromEntries(NOTIFICATION_EVENTS.map((event) => {
    const fallback = DEFAULT_NOTIFICATION_PREFS.events[event];
    const entry = saved.events?.[event];
    return [event, { enabled: typeof entry?.enabled === 'boolean' ? entry.enabled : fallback.enabled, sound: isSound(entry?.sound) ? entry.sound : fallback.sound }];
  })) as NotificationPrefs['events'];
  return { volume: isVolume(saved.volume) ? saved.volume : DEFAULT_NOTIFICATION_PREFS.volume, events };
}

/** The preferences of a save: every event present, volume between 0 and 1, each sound one of the bundled ones. */
export function validateNotificationPrefs(raw: string): NotificationPrefs {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Invalid notification settings'); }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid notification settings');
  const input = parsed as { volume?: unknown; events?: Record<string, { enabled?: unknown; sound?: unknown } | undefined> };
  if (!isVolume(input.volume)) throw new Error('Invalid notification volume');
  const events = Object.fromEntries(NOTIFICATION_EVENTS.map((event) => {
    const entry = input.events?.[event];
    if (typeof entry?.enabled !== 'boolean' || !isSound(entry.sound)) throw new Error(`Invalid notification setting for ${event}`);
    return [event, { enabled: entry.enabled, sound: entry.sound }];
  })) as NotificationPrefs['events'];
  return { volume: input.volume, events };
}

export interface EventPushDeps {
  prefs(): Promise<NotificationPrefs>;
  send(message: PushMessage): Promise<number>;
}

/** Pushes for the events the owner left on; the rest are dropped here so every device shares the choice. */
const gates = new Set<WeakRef<EventPush>>();

/** Called by a settings save so every gate reads the new choice at once. */
export function forgetNotificationPrefs() {
  for (const gate of gates) gate.deref()?.forget();
}

export class EventPush {
  private cached: { at: number; prefs: NotificationPrefs } | null = null;

  constructor(private readonly deps: EventPushDeps, private readonly now: () => number = Date.now) {
    gates.add(new WeakRef(this));
  }

  /** The saved preferences, read at most once per PREFS_TTL_MS; a save calls `forget` so it applies at once. */
  private async prefs(): Promise<NotificationPrefs> {
    if (!this.cached || this.now() - this.cached.at > PREFS_TTL_MS) this.cached = { at: this.now(), prefs: await this.deps.prefs() };
    return this.cached.prefs;
  }

  forget() {
    this.cached = null;
  }

  /** The event travels in the message data, so an open page can play its sound instead of showing a second notice. */
  async send(event: NotificationEvent, message: PushMessage): Promise<number> {
    if (!(await this.prefs()).events[event].enabled) return 0;
    return this.deps.send({ ...message, data: { ...message.data, event } });
  }
}
