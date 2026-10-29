/** Paths of the Workspace page: relative to the home folder, forward slashes, no leading slash. */

export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

export const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');

/** The same item under a new name in its own folder. */
export const renamedPath = (path: string, name: string) => joinPath(parentOf(path), name);

/** Why a name typed in the dialog cannot be used, or null when it can. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Type a name.';
  if (trimmed === '.' || trimmed === '..') return 'That name is reserved.';
  if (/[/\\]/.test(trimmed)) return 'A name cannot hold / or \\.';
  return null;
}
