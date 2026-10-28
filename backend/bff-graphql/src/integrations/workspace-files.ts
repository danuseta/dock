import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAX_ENTRIES = 2000;
export const MAX_PREVIEW_BYTES = 512 * 1024;
const BINARY_SNIFF_BYTES = 8192;

export class WorkspaceFilesError extends Error {}

export interface WorkspaceEntry { name: string; path: string; kind: 'dir' | 'file' | 'link' | 'other'; size: number | null; modifiedAt: string | null; masked: boolean }
export interface WorkspaceDir { path: string; parent: string | null; entries: WorkspaceEntry[]; truncated: boolean }
export interface WorkspaceFile { path: string; size: number; modifiedAt: string; masked: boolean; binary: boolean; truncated: boolean; text: string | null }

/** Folders that hold keys or logins: listed, never opened. */
const SECRET_DIRS = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.password-store', 'keyrings']);
const SECRET_PATHS = ['.config/gh', '.config/gcloud', '.docker/config.json'];
const SECRET_FILES = new Set(['.netrc', '.git-credentials', '.npmrc', '.pypirc', '.pgpass', '.bash_history', '.zsh_history', '.python_history', '.node_repl_history', '.psql_history']);
const SECRET_NAME = /(^\.env(\.(?!example$|sample$|template$)[^/]*)?$)|(^id_[a-z0-9]+(\.pub)?$)|(\.(pem|key|p12|pfx|jks|keystore|kdbx)$)/i;
// Source files named after a secret (token.service.ts, reset-password.tsx) stay readable; data and config files do not.
const SECRET_WORD = /credential|secret|token|passw|(^|[._-])pass([._-]|$)|api[-_]?key/i;
const DATA_FILE = /^[^.]*$|^\.[^.]+$|\.(json|txt|ya?ml|toml|ini|conf|cfg|env|properties|xml|pass)$/i;

/** True when a path under the home, relative and with forward slashes, names a secret or sits inside a secret folder. */
export function isMasked(relative: string): boolean {
  if (!relative) return false;
  const parts = relative.split('/');
  if (parts.some((part) => SECRET_DIRS.has(part))) return true;
  if (SECRET_PATHS.some((secret) => relative === secret || relative.startsWith(`${secret}/`))) return true;
  const name = parts[parts.length - 1];
  return SECRET_FILES.has(name) || SECRET_NAME.test(name) || (SECRET_WORD.test(name) && DATA_FILE.test(name));
}

/**
 * A read-only view of the folders and files under one root, the home of the user DOCK runs as. Paths go in and come out
 * relative to the root with forward slashes; one that leaves the root, by `..` or through a link, is refused.
 */
export class WorkspaceFiles {
  constructor(private readonly root: string = os.homedir()) {}

  private async resolve(input: string | null | undefined): Promise<{ absolute: string; relative: string }> {
    const raw = (input ?? '').replace(/\\/g, '/');
    if (raw.split('/').includes('..')) throw new WorkspaceFilesError('That path leaves the home folder');
    const relative = path.posix.normalize(`/${raw}`).slice(1).replace(/\/$/, '');
    const root = await fs.realpath(this.root);
    let real: string;
    try {
      real = await fs.realpath(path.join(root, relative));
    } catch {
      throw new WorkspaceFilesError(`${relative || '~'} does not exist`);
    }
    if (real !== root && !real.startsWith(root + path.sep)) throw new WorkspaceFilesError('That path leads out of the home folder');
    return { absolute: real, relative };
  }

  async dir(input?: string | null): Promise<WorkspaceDir> {
    const { absolute, relative } = await this.resolve(input);
    if (isMasked(relative)) throw new WorkspaceFilesError(`${relative} holds secrets, so it stays closed`);
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) throw new WorkspaceFilesError(`${relative} is not a folder`);
    const names = (await fs.readdir(absolute, { withFileTypes: true })).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const entries: WorkspaceEntry[] = [];
    for (const dirent of names.slice(0, MAX_ENTRIES)) {
      const child = relative ? `${relative}/${dirent.name}` : dirent.name;
      const info = await fs.stat(path.join(absolute, dirent.name)).catch(() => null);
      const kind = info?.isDirectory() ? 'dir' : info?.isFile() ? 'file' : dirent.isSymbolicLink() ? 'link' : 'other';
      entries.push({ name: dirent.name, path: child, kind, size: kind === 'file' ? info!.size : null, modifiedAt: info?.mtime.toISOString() ?? null, masked: isMasked(child) });
    }
    const parent = relative ? relative.split('/').slice(0, -1).join('/') : null;
    return { path: relative, parent, entries, truncated: names.length > MAX_ENTRIES };
  }

  async file(input: string): Promise<WorkspaceFile> {
    const { absolute, relative } = await this.resolve(input);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new WorkspaceFilesError(`${relative || '~'} is not a file`);
    const base = { path: relative, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    if (isMasked(relative)) return { ...base, masked: true, binary: false, truncated: false, text: null };
    const handle = await fs.open(absolute, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_PREVIEW_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const read = buffer.subarray(0, bytesRead);
      if (read.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { ...base, masked: false, binary: true, truncated: false, text: null };
      return { ...base, masked: false, binary: false, truncated: stat.size > MAX_PREVIEW_BYTES, text: read.toString('utf8') };
    } finally {
      await handle.close();
    }
  }
}

export const workspaceFiles = new WorkspaceFiles();
