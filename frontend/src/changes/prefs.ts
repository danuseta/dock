/** What the Changes page remembers on this device. Storage can be missing or throw, so every read and write is guarded. */

export type DiffView = 'unified' | 'split';

const VIEW_KEY = 'dock-changes-view';
const VIEWED_KEY = 'dock-changes-viewed:';

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* the choice lasts until the page closes */ }
}

export const readView = (): DiffView => (read(VIEW_KEY) === 'split' ? 'split' : 'unified');
export const writeView = (view: DiffView) => write(VIEW_KEY, view);

/** A short hash of a patch, so a file stays viewed only while its diff is the same. */
export function patchHash(patch: string | null): string {
  let hash = 5381;
  for (const char of patch ?? '') hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

/** The files of a pull request marked viewed: path to the hash of the patch it was viewed with. */
export function readViewed(url: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(read(`${VIEWED_KEY}${url}`) ?? '{}');
    return value && typeof value === 'object' ? value as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function writeViewed(url: string, viewed: Record<string, string>) {
  write(`${VIEWED_KEY}${url}`, JSON.stringify(viewed));
}

export const isViewed = (viewed: Record<string, string>, path: string, patch: string | null) => viewed[path] === patchHash(patch);
