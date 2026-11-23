import { STORAGE_PLUGINS, VOICE_PLUGINS } from '../datasources/StorageAPI';
import { StorageService } from '../storage/service';
import { demoStorage, type DemoStorage } from './demo-storage';
import { elevenLabsKeys, type ElevenLabsKeys } from './elevenlabs-keys';

export type StoragePlugin = typeof STORAGE_PLUGINS[number];
export type VoicePlugin = typeof VOICE_PLUGINS[number];

export const STORAGE_PLUGIN_SETTING = 'storagePlugin';
export const VOICE_PLUGIN_SETTING = 'voicePlugin';
export const STORAGE_LOCAL_DIR_SETTING = 'storageLocalDir';

export interface PluginChoices { storage: StoragePlugin; voice: VoicePlugin; storageLocalDir: string }

export interface PluginSources {
  setting(key: string): Promise<string | undefined>;
  s3Configured(): Promise<boolean>;
  hasVoiceKeys(): Promise<boolean>;
}

const pick = <T extends string>(allowed: readonly T[], value: string | undefined): T | null => (allowed.find((item) => item === value) ?? null);

/** The saved choice, or for an install that never chose, what it already runs: S3 when the demo storage is set, ElevenLabs when it has keys. */
export async function resolvePlugins(sources: PluginSources): Promise<PluginChoices> {
  const [storage, voice, storageLocalDir] = await Promise.all([
    sources.setting(STORAGE_PLUGIN_SETTING), sources.setting(VOICE_PLUGIN_SETTING), sources.setting(STORAGE_LOCAL_DIR_SETTING),
  ]);
  return {
    storage: pick(STORAGE_PLUGINS, storage) ?? ((await sources.s3Configured()) ? 's3' : 'none'),
    voice: pick(VOICE_PLUGINS, voice) ?? ((await sources.hasVoiceKeys()) ? 'elevenlabs' : 'none'),
    storageLocalDir: storageLocalDir?.trim() ?? '',
  };
}

export const livePluginSources = (storage = new StorageService(), s3: DemoStorage = demoStorage, keys: ElevenLabsKeys = elevenLabsKeys): PluginSources => ({
  setting: async (key) => (await storage.getSettingValues([key]))[0]?.value,
  s3Configured: async () => Boolean(await s3.full().catch(() => null)),
  hasVoiceKeys: async () => (await keys.list().catch(() => [])).length > 0,
});

export const livePlugins = () => resolvePlugins(livePluginSources());
