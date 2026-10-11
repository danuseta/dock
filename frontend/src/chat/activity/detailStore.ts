export interface DetailEntry { state: 'idle' | 'loading' | 'ready' | 'failed'; text: string | null }

export interface DetailStore {
  get: (id: number) => DetailEntry;
  load: (id: number, version?: string) => void;
  subscribe: (listener: () => void) => () => void;
}

const IDLE: DetailEntry = { state: 'idle', text: null };

export function createDetailStore(fetchDetail: (id: number) => Promise<string | null>): DetailStore {
  const entries = new Map<number, DetailEntry>();
  const versions = new Map<number, string>();
  const listeners = new Set<() => void>();
  const set = (id: number, entry: DetailEntry) => {
    entries.set(id, entry);
    listeners.forEach((listener) => listener());
  };
  return {
    get: (id) => entries.get(id) ?? IDLE,
    load: (id, version = '') => {
      const current = entries.get(id);
      if (current && (current.state === 'loading' || (current.state === 'ready' && versions.get(id) === version))) return;
      versions.set(id, version);
      set(id, { state: 'loading', text: current?.text ?? null });
      fetchDetail(id).then(
        (text) => set(id, { state: 'ready', text }),
        () => set(id, { state: 'failed', text: null }),
      );
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
