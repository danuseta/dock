import type { DemoStorage } from './demo-storage';
import type { ElevenLabsKeys } from './elevenlabs-keys';

export interface PulledSecrets { keys: string[]; current: string | null; parked: string[]; storage: boolean }

/** Copies the ElevenLabs keys and the demo storage settings of another DOCK into this one. Returns names only, never a value. */
export async function pullPeerSecrets(from: { keys: ElevenLabsKeys; storage: DemoStorage }, to: { keys: ElevenLabsKeys; storage: DemoStorage }): Promise<PulledSecrets> {
  const store = await from.keys.store();
  for (const name of store.order) await to.keys.add(name, store.keys[name]);
  const current = store.order[store.current] ?? null;
  if (current) await to.keys.setCurrent(current);
  const parked = Object.entries(store.cooldowns);
  for (const [name, until] of parked) await to.keys.park(name, new Date(until));
  const config = await from.storage.full();
  if (config) await to.storage.save(config);
  return { keys: store.order, current, parked: parked.map(([name]) => name), storage: Boolean(config) };
}
