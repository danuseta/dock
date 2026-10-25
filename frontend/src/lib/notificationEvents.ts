import { soundUrl, type NotificationEventId, type NotificationPrefs } from './notificationPrefs';

/** Tags match the ones the server pushes with. */
export interface NotifyEvent { event: NotificationEventId; tag: string; title: string; body: string; url: string }

export interface SessionStatus { id: string; title: string; status: string; statusDetail?: string | null; origin?: string; ticketKey?: string | null }

const RUNNING = new Set(['queued', 'running']);
const STOPPED = /^Stopped/;

/**
 * Sessions that went from running to idle since the previous look, other than a turn the owner stopped and a
 * ticket session of the cron (its run announces itself). The first look (`previous` is null) only remembers,
 * so opening or reloading the page never replays what already ended.
 */
export function finishedSessions(previous: Map<string, string> | null, sessions: SessionStatus[]): { seen: Map<string, string>; events: NotifyEvent[] } {
  const seen = new Map(sessions.map((session) => [session.id, session.status]));
  const ended = (session: SessionStatus) => session.status === 'idle' && RUNNING.has(previous?.get(session.id) ?? '')
    && !STOPPED.test(session.statusDetail ?? '') && session.origin !== 'cron' && !session.ticketKey;
  const events = previous ? sessions.filter(ended).map((session): NotifyEvent => ({
    event: 'sessionDone',
    tag: `done-${session.id}`,
    title: `${session.title || 'A session'} finished`,
    body: 'The agent finished its turn.',
    url: `/sessions?session=${encodeURIComponent(session.id)}`,
  })) : [];
  return { seen, events };
}

export interface AttentionSignal { id: string; type: string; message: string; ticketKey?: string | null }

const ATTENTION_TAG: Record<string, { prefix: string; title: string }> = {
  AGENT_STALLED: { prefix: 'stalled', title: 'is stalled' },
  AGENT_WAITING: { prefix: 'wait', title: 'waits on you' },
};

/**
 * Stalled or waiting runs that were not in the previous look; the first look only remembers. A stalled run is told
 * once per stall, since its message counts minutes and changes every look; a waiting run once per question.
 */
export function newAttention(previous: Set<string> | null, items: AttentionSignal[]): { seen: Set<string>; events: NotifyEvent[] } {
  const relevant = items.flatMap((item) => (item.ticketKey && ATTENTION_TAG[item.type]
    ? [{ item, ticketKey: item.ticketKey, key: item.type === 'AGENT_STALLED' ? item.id : `${item.id}\n${item.message}` }]
    : []));
  const seen = new Set(relevant.map(({ key }) => key));
  const events = previous ? relevant.filter(({ key }) => !previous.has(key)).map(({ item, ticketKey }): NotifyEvent => ({
    event: 'needsYou',
    tag: `${ATTENTION_TAG[item.type].prefix}-${ticketKey}`,
    title: `${ticketKey} ${ATTENTION_TAG[item.type].title}`,
    body: item.message.slice(0, 180),
    url: `/detail/${encodeURIComponent(ticketKey)}`,
  })) : [];
  return { seen, events };
}

export interface DiscordPostRow { id: string; channel: string; messages: Array<{ id: string; author: string; mine: boolean; text: string }> }

/**
 * Messages of followed threads that were not in the previous look and are not the owner's; the first look only
 * remembers. A thread that was not there before announces its newest message only, not its whole history.
 */
export function newDiscordPosts(previous: Set<string> | null, rows: DiscordPostRow[]): { seen: Set<string>; events: NotifyEvent[] } {
  const seen = new Set(rows.flatMap((row) => [`thread:${row.id}`, ...row.messages.map((message) => message.id)]));
  const events = previous ? rows.flatMap((row) => {
    const fresh = row.messages.filter((message) => !previous.has(message.id) && !message.mine);
    return (previous.has(`thread:${row.id}`) ? fresh : fresh.slice(-1)).map((message): NotifyEvent => ({
      event: 'discordPost',
      tag: `discord-${row.id}-${message.id}`,
      title: `${row.channel}: ${message.author}`,
      body: message.text.slice(0, 180),
      url: '/discord',
    }));
  }) : [];
  return { seen, events };
}

/** The sound at the saved volume. A browser that has not allowed sound yet refuses; that is not an error. */
export function playSound(sound: string, volume: number) {
  const audio = new Audio(soundUrl(sound));
  audio.volume = Math.min(1, Math.max(0, volume));
  void audio.play().catch(() => undefined);
}

async function hasPushSubscription(): Promise<boolean> {
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    return Boolean(await registration?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/** Through the service worker, the only way Android Chrome and an installed iPhone app take one; a click is handled by sw.js. */
async function showNotice(item: NotifyEvent) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const options = { body: item.body, tag: item.tag, icon: '/icon-192.png', data: { url: item.url } };
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (registration) await registration.showNotification(item.title, options);
    else new Notification(item.title, options);
  } catch {
    // A browser that refuses the notification must not break the page; the sound already played.
  }
}

/**
 * A sound and a notification for each event the owner left on. A device with a push subscription is told by the
 * server's push instead (see `soundForPush`), so it hears and sees each event once.
 */
export async function announce(events: NotifyEvent[], prefs: NotificationPrefs) {
  const wanted = events.filter((item) => prefs.events[item.event].enabled);
  if (wanted.length === 0 || await hasPushSubscription()) return;
  for (const item of wanted) {
    playSound(prefs.events[item.event].sound, prefs.volume);
    await showNotice(item);
  }
}

/** What the service worker sends a page in view instead of showing a notification: the sound to play, if any. */
export function soundForPush(message: unknown, prefs: NotificationPrefs): { sound: string; volume: number } | null {
  const sent = message as { type?: unknown; event?: unknown } | null;
  if (sent?.type !== 'dock-push' || typeof sent.event !== 'string' || !(sent.event in prefs.events)) return null;
  const choice = prefs.events[sent.event as NotificationEventId];
  return choice.enabled ? { sound: choice.sound, volume: prefs.volume } : null;
}
