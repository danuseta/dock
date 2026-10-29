import { promises as fs, type Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAX_ENTRIES = 2000;
export const MAX_PREVIEW_BYTES = 512 * 1024;
export const MAX_WRITE_BYTES = 50 * 1024 * 1024;
/** A folder with more items than this is not walked for secrets, so it cannot be moved or deleted from DOCK. */
export const MAX_WALK_ENTRIES = 50000;
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
 * The folders and files under one root, the home of the user DOCK runs as. Paths go in and come out
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

  /** A path to create, change or remove: its folder resolved inside the root, the last name kept as is so a link is never followed. */
  private async target(input: string | null | undefined): Promise<{ absolute: string; relative: string }> {
    const raw = (input ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    const name = raw.split('/').pop() ?? '';
    if (!name || name === '.' || name === '..') throw new WorkspaceFilesError('A name is required');
    const folder = await this.resolve(raw.slice(0, raw.length - name.length));
    if (!(await fs.stat(folder.absolute)).isDirectory()) throw new WorkspaceFilesError(`${folder.relative || '~'} is not a folder`);
    const relative = folder.relative ? `${folder.relative}/${name}` : name;
    if (isMasked(relative)) throw new WorkspaceFilesError(`${relative} holds secrets, so it is read only`);
    return { absolute: path.join(folder.absolute, name), relative };
  }

  /** Refuses a folder that holds a secret anywhere inside it; dependency folders are not walked. */
  private async holdsNoSecret(absolute: string, relative: string): Promise<void> {
    const stack = [{ absolute, relative }];
    let seen = 0;
    while (stack.length) {
      const current = stack.pop()!;
      for (const dirent of await fs.readdir(current.absolute, { withFileTypes: true })) {
        if (++seen > MAX_WALK_ENTRIES) throw new WorkspaceFilesError(`${relative} holds more than ${MAX_WALK_ENTRIES.toLocaleString('en-US')} items, too many to check for secrets`);
        const child = `${current.relative}/${dirent.name}`;
        if (isMasked(child)) throw new WorkspaceFilesError(`${relative} holds a secret (${child}), so it stays where it is`);
        if (dirent.isDirectory() && dirent.name !== 'node_modules') stack.push({ absolute: path.join(current.absolute, dirent.name), relative: child });
      }
    }
  }

  private async existing(input: string): Promise<{ absolute: string; relative: string; stat: Stats }> {
    const found = await this.target(input);
    const stat = await fs.lstat(found.absolute).catch(() => null);
    if (!stat) throw new WorkspaceFilesError(`${found.relative} does not exist`);
    if (stat.isDirectory()) await this.holdsNoSecret(found.absolute, found.relative);
    return { ...found, stat };
  }

  private async fresh(input: string): Promise<{ absolute: string; relative: string }> {
    const found = await this.target(input);
    if (await fs.lstat(found.absolute).then(() => true, () => false)) throw new WorkspaceFilesError(`${found.relative} already exists`);
    return found;
  }

  async mkdir(input: string): Promise<WorkspaceEntry> {
    const { absolute, relative } = await this.fresh(input);
    await fs.mkdir(absolute);
    return this.entry(absolute, relative);
  }

  /**
   * Writes a file: a new one, or with `replace` the one already there. `expected` is the modified time the editor
   * opened, so a file changed on disk since then is not overwritten.
   */
  async write(input: string, data: Buffer, options: { replace?: boolean; expected?: string | null } = {}): Promise<WorkspaceEntry> {
    if (data.length > MAX_WRITE_BYTES) throw new WorkspaceFilesError(`A file can be at most ${MAX_WRITE_BYTES / 1024 / 1024} MB`);
    const found = await this.target(input);
    const stat = await fs.lstat(found.absolute).catch(() => null);
    if (stat && !options.replace) throw new WorkspaceFilesError(`${found.relative} already exists`);
    if (stat && !stat.isFile()) throw new WorkspaceFilesError(`${found.relative} is not a file`);
    if (stat && options.expected && stat.mtime.toISOString() !== options.expected) throw new WorkspaceFilesError(`${found.relative} changed on disk after it was opened; reopen it first`);
    await fs.writeFile(found.absolute, data);
    return this.entry(found.absolute, found.relative);
  }

  async rename(from: string, to: string): Promise<WorkspaceEntry> {
    const source = await this.existing(from);
    const destination = await this.fresh(to);
    await fs.rename(source.absolute, destination.absolute);
    return this.entry(destination.absolute, destination.relative);
  }

  async remove(input: string): Promise<boolean> {
    const { absolute } = await this.existing(input);
    await fs.rm(absolute, { recursive: true });
    return true;
  }

  private async entry(absolute: string, relative: string): Promise<WorkspaceEntry> {
    const info = await fs.lstat(absolute);
    const kind = info.isDirectory() ? 'dir' : info.isFile() ? 'file' : info.isSymbolicLink() ? 'link' : 'other';
    return { name: path.basename(relative), path: relative, kind, size: kind === 'file' ? info.size : null, modifiedAt: info.mtime.toISOString(), masked: false };
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
