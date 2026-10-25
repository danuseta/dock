export const NOTIFICATION_SOUNDS = [
  { id: 'confirmation_001', label: 'Chime' },
  { id: 'confirmation_002', label: 'Ding' },
  { id: 'confirmation_003', label: 'Success' },
  { id: 'glass_001', label: 'Glass' },
  { id: 'glass_003', label: 'Crystal' },
  { id: 'bong_001', label: 'Bong' },
  { id: 'drop_002', label: 'Drop' },
  { id: 'maximize_004', label: 'Rise' },
  { id: 'open_001', label: 'Open' },
  { id: 'pluck_001', label: 'Pluck' },
] as const;

export const NOTIFICATION_EVENTS = [
  { id: 'sessionDone', label: 'Agent session finished', help: 'A chat turn or a ticket run reached its end.' },
  { id: 'needsYou', label: 'Run stale or needs help', help: 'A run stalled, or waits on you for an answer.' },
  { id: 'discordPost', label: 'New Discord post', help: 'Every new post in the channels DOCK follows, except yours.' },
] as const;

export type NotificationEventId = typeof NOTIFICATION_EVENTS[number]['id'];

export interface NotificationPrefs {
  volume: number;
  events: Record<NotificationEventId, { enabled: boolean; sound: string }>;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  volume: 0.6,
  events: {
    sessionDone: { enabled: true, sound: 'confirmation_001' },
    needsYou: { enabled: true, sound: 'glass_001' },
    discordPost: { enabled: true, sound: 'bong_001' },
  },
};

export const soundUrl = (sound: string) => `/sounds/${sound}.wav`;

const isSound = (value: unknown): value is string => NOTIFICATION_SOUNDS.some((sound) => sound.id === value);

/** The saved preferences, with the default for every missing or malformed part. */
export function parseNotificationPrefs(raw: string | null | undefined): NotificationPrefs {
  let saved: { volume?: unknown; events?: Record<string, { enabled?: unknown; sound?: unknown } | undefined> } = {};
  try { saved = JSON.parse(raw || '{}') ?? {}; } catch { /* unreadable: all defaults */ }
  const events = Object.fromEntries(NOTIFICATION_EVENTS.map(({ id }) => {
    const entry = saved.events?.[id];
    const fallback = DEFAULT_NOTIFICATION_PREFS.events[id];
    return [id, { enabled: typeof entry?.enabled === 'boolean' ? entry.enabled : fallback.enabled, sound: isSound(entry?.sound) ? entry.sound : fallback.sound }];
  })) as NotificationPrefs['events'];
  const volume = typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : DEFAULT_NOTIFICATION_PREFS.volume;
  return { volume, events };
}

/** The form of the Notifications section: the volume in percent and, per event, `<id>On` and `<id>Sound`. */
export function prefsToValues(prefs: NotificationPrefs): Record<string, string> {
  return Object.fromEntries([
    ['volume', String(Math.round(prefs.volume * 100))],
    ...NOTIFICATION_EVENTS.flatMap(({ id }) => [[`${id}On`, String(prefs.events[id].enabled)], [`${id}Sound`, prefs.events[id].sound]]),
  ]);
}

export function valuesToPrefs(values: Record<string, string>): NotificationPrefs {
  const events = Object.fromEntries(NOTIFICATION_EVENTS.map(({ id }) => [id, { enabled: values[`${id}On`] === 'true', sound: values[`${id}Sound`] }])) as NotificationPrefs['events'];
  return { volume: Math.min(1, Math.max(0, Number(values.volume) / 100)), events };
}
