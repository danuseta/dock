import webpush from 'web-push';
import { StorageService } from '../storage/service';
import { OrchestratorInputError } from './orchestrator';

const PUBLIC_KEY = 'pushVapidPublicKey';
const PRIVATE_KEY = 'pushVapidPrivateKey';
// The push services want a contact for whoever sends; Apple refuses a mailto on a made-up domain.
const CONTACT = 'https://github.com/danuseta/dock';
const CACHE = 'push';
const MAX_SUBSCRIPTIONS = 20;
const GONE = new Set([404, 410]);

export interface PushSubscription { endpoint: string; p256dh: string; auth: string }
export interface PushAction { action: string; title: string }

/** What the service worker shows. `actions` become buttons; `data` tells the worker what a button does. */
export interface PushMessage { title: string; body: string; url: string; tag?: string; actions?: PushAction[]; data?: Record<string, unknown> }

export interface PushDeps {
  settingValue(key: string): Promise<string | null>;
  saveSetting(key: string, value: string, description: string): Promise<unknown>;
  cacheGet(key: string): Promise<unknown>;
  cacheSet(key: string, value: unknown): Promise<unknown>;
  generateKeys(): { publicKey: string; privateKey: string };
  /** Resolves the HTTP status of a rejected push; throws for anything that is not an HTTP answer. */
  deliver(subscription: PushSubscription, payload: string, keys: { publicKey: string; privateKey: string }): Promise<number>;
}

function parseSubscription(input: { endpoint?: unknown; p256dh?: unknown; auth?: unknown }): PushSubscription {
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  const p256dh = typeof input.p256dh === 'string' ? input.p256dh.trim() : '';
  const auth = typeof input.auth === 'string' ? input.auth.trim() : '';
  if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint)) throw new OrchestratorInputError('endpoint must be an https push endpoint');
  if (!/^[\w-]{20,200}=*$/.test(p256dh) || !/^[\w-]{10,100}=*$/.test(auth)) throw new OrchestratorInputError('p256dh and auth must be the keys of a push subscription');
  return { endpoint, p256dh, auth };
}

export class PushService {
  constructor(private readonly deps: PushDeps) {}

  /** The server's VAPID keys, made on first use and kept for good: a new pair would orphan every subscription. */
  private async keys() {
    const [publicKey, privateKey] = await Promise.all([this.deps.settingValue(PUBLIC_KEY), this.deps.settingValue(PRIVATE_KEY)]);
    if (publicKey && privateKey) return { publicKey, privateKey };
    const made = this.deps.generateKeys();
    await this.deps.saveSetting(PUBLIC_KEY, made.publicKey, 'Web push public key');
    await this.deps.saveSetting(PRIVATE_KEY, made.privateKey, 'Web push private key');
    return made;
  }

  async publicKey(): Promise<string> {
    return (await this.keys()).publicKey;
  }

  async subscriptions(): Promise<PushSubscription[]> {
    const saved = await this.deps.cacheGet('subscriptions');
    return Array.isArray(saved) ? saved as PushSubscription[] : [];
  }

  async subscribe(input: { endpoint?: unknown; p256dh?: unknown; auth?: unknown }): Promise<void> {
    const subscription = parseSubscription(input);
    const others = (await this.subscriptions()).filter((item) => item.endpoint !== subscription.endpoint);
    await this.deps.cacheSet('subscriptions', [...others, subscription].slice(-MAX_SUBSCRIPTIONS));
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.deps.cacheSet('subscriptions', (await this.subscriptions()).filter((item) => item.endpoint !== endpoint));
  }

  /** Sends to every device; a device whose subscription the push service no longer knows is forgotten. Resolves how many were reached. */
  async send(message: PushMessage): Promise<number> {
    const subscriptions = await this.subscriptions();
    if (subscriptions.length === 0) return 0;
    const keys = await this.keys();
    const payload = JSON.stringify(message);
    const statuses = await Promise.all(subscriptions.map((subscription) => this.deps.deliver(subscription, payload, keys).catch(() => 0)));
    const kept = subscriptions.filter((_, index) => !GONE.has(statuses[index]));
    if (kept.length !== subscriptions.length) await this.deps.cacheSet('subscriptions', kept);
    return statuses.filter((status) => status >= 200 && status < 300).length;
  }
}

const storage = new StorageService();

async function deliver(subscription: PushSubscription, payload: string, keys: { publicKey: string; privateKey: string }): Promise<number> {
  try {
    const sent = await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
      { vapidDetails: { subject: CONTACT, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 3600 },
    );
    return sent.statusCode;
  } catch (error) {
    if (error instanceof webpush.WebPushError) return error.statusCode;
    throw error;
  }
}

export const pushService = new PushService({
  settingValue: async (key) => (await storage.getSettings()).find((setting) => setting.key === key)?.value ?? null,
  saveSetting: (key, value, description) => storage.upsertSetting(key, value, description),
  cacheGet: (key) => storage.getCache(CACHE, key),
  cacheSet: (key, value) => storage.upsertCache(CACHE, key, value, 0),
  generateKeys: () => webpush.generateVAPIDKeys(),
  deliver,
});
