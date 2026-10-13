import type { InMemoryCache } from '@apollo/client';

// The version changes when the shape of what is cached changes, so an old copy is never read into new code.
const KEY = 'dock-apollo-cache-v1';

interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** Fills the cache with what this device saw last, so the app has something to show before, or without, the server. */
export function restoreCache(cache: Pick<InMemoryCache, 'restore'>, store: Store = localStorage): void {
  const saved = store.getItem(KEY);
  if (!saved) return;
  try {
    cache.restore(JSON.parse(saved));
  } catch {
    store.removeItem(KEY);
  }
}

/** Writes the cache to the device. When it no longer fits the browser's quota the saved copy is dropped rather than left stale. */
export function saveCache(cache: Pick<InMemoryCache, 'extract'>, store: Store = localStorage): void {
  try {
    store.setItem(KEY, JSON.stringify(cache.extract()));
  } catch {
    store.removeItem(KEY);
  }
}

/** Saves whenever the app goes to the background: the last moment a phone gives a page before it may be closed. */
export function keepCacheOnDevice(cache: InMemoryCache): void {
  restoreCache(cache);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveCache(cache); });
  window.addEventListener('pagehide', () => saveCache(cache));
}
