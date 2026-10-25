import { StorageService } from '../storage/service';
import { maskKey } from './elevenlabs-keys';
import { OrchestratorInputError } from './orchestrator';

export const DEMO_STORAGE_SETTING = 'demoStorage';
export const FOLDER = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Where the demo videos go and the link they get, kept in this DOCK's database. */
export interface DemoStorageConfig { endpoint: string; region: string; bucket: string; folder: string; publicBaseUrl: string; accessKey: string; secretKey: string }
export interface DemoStorageView { configured: boolean; endpoint: string; region: string; bucket: string; folder: string; publicBaseUrl: string; accessKeyMasked: string | null; secretSet: boolean }
export type DemoStorageInput = Partial<DemoStorageConfig>;

export const DEMO_STORAGE_DEFAULTS: DemoStorageConfig = {
  endpoint: '',
  region: '',
  bucket: '',
  folder: '',
  publicBaseUrl: '',
  accessKey: '',
  secretKey: '',
};

export interface DemoStorage {
  view(): Promise<DemoStorageView>;
  save(input: DemoStorageInput): Promise<DemoStorageView>;
  clear(): Promise<boolean>;
  /** The full settings with the keys, or null until both keys are set. */
  full(): Promise<DemoStorageConfig | null>;
}

const isComplete = (config: DemoStorageConfig) => Boolean(config.accessKey && config.secretKey && config.endpoint && config.bucket && config.folder);

export function viewOf(config: DemoStorageConfig): DemoStorageView {
  const { accessKey, secretKey, ...rest } = config;
  return { ...rest, configured: isComplete(config), accessKeyMasked: accessKey ? maskKey(accessKey) : null, secretSet: Boolean(secretKey) };
}

function httpsUrl(value: string, name: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new OrchestratorInputError(`${name} must be a URL`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new OrchestratorInputError(`${name} must be an https URL without a login`);
  return value.replace(/\/+$/, '');
}

/** The saved settings with the input over them. An empty key in the input keeps the saved one, so the form never has to show it. */
export function mergeDemoStorage(saved: DemoStorageConfig, input: DemoStorageInput): DemoStorageConfig {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const next = { ...saved };
  for (const name of ['endpoint', 'region', 'bucket', 'folder', 'publicBaseUrl', 'accessKey', 'secretKey'] as const) {
    const value = text(input[name]);
    if (value) next[name] = value;
  }
  next.endpoint = httpsUrl(next.endpoint, 'The endpoint');
  next.publicBaseUrl = httpsUrl(next.publicBaseUrl, 'The public base URL');
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(next.bucket)) throw new OrchestratorInputError('The bucket is 2 to 63 lowercase letters, digits, dots or dashes');
  next.folder = next.folder.replace(/^\/+|\/+$/g, '');
  if (!FOLDER.test(next.folder)) throw new OrchestratorInputError('The folder is one name of lowercase letters, digits, dashes or underscores');
  if (!next.region) throw new OrchestratorInputError('The region is required');
  return next;
}

export class LocalDemoStorage implements DemoStorage {
  constructor(private readonly storage = new StorageService()) {}

  private async saved(): Promise<DemoStorageConfig> {
    const value = (await this.storage.getSettings()).find((setting) => setting.key === DEMO_STORAGE_SETTING)?.value;
    if (!value) return DEMO_STORAGE_DEFAULTS;
    try { return { ...DEMO_STORAGE_DEFAULTS, ...JSON.parse(value) }; } catch { return DEMO_STORAGE_DEFAULTS; }
  }

  async view() { return viewOf(await this.saved()); }

  async save(input: DemoStorageInput) {
    const next = mergeDemoStorage(await this.saved(), input);
    await this.storage.upsertSetting(DEMO_STORAGE_SETTING, JSON.stringify(next), 'Demo video storage (S3) for both DOCKs');
    return viewOf(next);
  }

  async clear() {
    await this.storage.deleteSetting(DEMO_STORAGE_SETTING);
    return true;
  }

  async full() {
    const config = await this.saved();
    return isComplete(config) ? config : null;
  }
}

export class PeerDemoStorage implements DemoStorage {
  constructor(private readonly call: (route: string, body: unknown) => Promise<unknown>) {}
  view() { return this.call('/demo-storage/view', {}) as Promise<DemoStorageView>; }
  save(input: DemoStorageInput) { return this.call('/demo-storage/save', input) as Promise<DemoStorageView>; }
  async clear() { return Boolean(await this.call('/demo-storage/clear', {})); }
  async full() { return ((await this.call('/demo-storage/full', {})) as { config: DemoStorageConfig | null }).config; }
}

export const DEMO_STORAGE_ROUTES = ['view', 'save', 'clear', 'full'] as const;

/** The ingest routes a machine token (or the workspace DOCK) calls. */
export function demoStorageRoute(storage: DemoStorage, route: string, body: Record<string, unknown>) {
  switch (route) {
    case 'view': return storage.view();
    case 'save': return storage.save(body as DemoStorageInput);
    case 'clear': return storage.clear();
    // Wrapped: a bare null would read as an unknown route.
    case 'full': return storage.full().then((config) => ({ config }));
    default: throw new OrchestratorInputError('Unknown demo storage route');
  }
}

export const demoStorage: DemoStorage = new LocalDemoStorage();
