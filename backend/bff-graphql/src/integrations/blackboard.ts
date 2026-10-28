import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** What the sous agents write per ticket on the workspace: the ledger renders, review notes, prompts, screenshots. */
export const defaultBlackboardRoot = () => process.env.DOCK_BLACKBOARD_DIR || path.join(os.homedir(), 'projects', '.evidence', 'blackboard');
/** The sprint boards: Sprint-<N>/<Epic>/ folders holding one materials file, or one folder, per ticket. */
export const defaultSprintBoardsRoot = () => process.env.DOCK_SPRINT_BOARDS_DIR || path.join(os.homedir(), 'Desktop', 'blackboard');

const TEXT_TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
};
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_DEPTH = 4;
const TICKET_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const SPRINT = /^Sprint-\d+$/i;
const KEY_IN_NAME = /(?:^|[^A-Z0-9])([A-Z][A-Z0-9]+-\d+)(?![0-9])/;
/** Rendered from the ledger by status.cjs; the page marks them so nobody edits them by hand. */
const GENERATED = new Set(['NOW.md', 'status.md', 'decisions.md', 'issues.md']);

export type BlackboardFileKind = 'text' | 'image' | 'video' | 'other';
export interface BlackboardTicket { key: string; epic: string | null; updatedAt: string; files: number }
export interface BlackboardFile { path: string; size: number; updatedAt: string; kind: BlackboardFileKind; generated: boolean }
export interface BlackboardOpened { file: string; size: number; mime: string; name: string; inline: boolean }

export class BlackboardRefusal extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const extOf = (name: string) => path.extname(name).slice(1).toLowerCase();

export function fileKind(name: string): BlackboardFileKind {
  const ext = extOf(name);
  if (TEXT_TYPES[ext]) return 'text';
  if (ext === 'mp4' || ext === 'webm') return 'video';
  if (MEDIA_TYPES[ext]) return 'image';
  return 'other';
}

/** A path inside a ticket folder as the page sends it: relative, forward slashes, no dot segments. */
export function cleanRelative(input: string): string | null {
  const text = String(input || '').replace(/\\/g, '/');
  if (!text || text.startsWith('/') || /^[a-zA-Z]:/.test(text) || text.includes('\0')) return null;
  const parts = text.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))) return null;
  return parts.join('/');
}

const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

interface SprintTicket { epic: string; files: BlackboardFile[] }

export class Blackboard {
  constructor(private readonly root: string = defaultBlackboardRoot(), private readonly sprintRoot: string = defaultSprintBoardsRoot()) {}

  /**
   * Every ticket, newest change first: the ledger boards (an epic board lists itself and the tickets under its tickets/
   * folder) and the tickets of the sprint boards, merged by key.
   */
  async tickets(): Promise<BlackboardTicket[]> {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const found = new Map<string, BlackboardTicket>();
    for (const entry of entries) {
      if (!entry.isDirectory() || !TICKET_KEY.test(entry.name)) continue;
      const dir = path.join(this.root, entry.name);
      found.set(entry.name, await this.summary(entry.name, null, dir));
      const nested = await fs.readdir(path.join(dir, 'tickets'), { withFileTypes: true }).catch(() => []);
      for (const child of nested) {
        if (child.isDirectory() && TICKET_KEY.test(child.name)) found.set(child.name, await this.summary(child.name, entry.name, path.join(dir, 'tickets', child.name)));
      }
    }
    for (const [key, sprint] of await this.sprintTickets()) {
      const updatedAt = sprint.files.reduce((latest, file) => (file.updatedAt > latest ? file.updatedAt : latest), '');
      const ledger = found.get(key);
      found.set(key, ledger
        ? { ...ledger, epic: ledger.epic ?? sprint.epic, files: ledger.files + sprint.files.length, updatedAt: updatedAt > ledger.updatedAt ? updatedAt : ledger.updatedAt }
        : { key, epic: sprint.epic, files: sprint.files.length, updatedAt });
    }
    return [...found.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** The files of one ticket: its ledger folder, then its sprint board files under Sprint-<N>/<Epic>/. Null when it has none. */
  async files(key: string): Promise<BlackboardFile[] | null> {
    const dir = await this.dirOf(key);
    const sprint = (await this.sprintTickets()).get(String(key || '').trim().toUpperCase());
    if (!dir && !sprint) return null;
    return [...(dir ? await this.walk(dir) : []), ...(sprint?.files ?? [])];
  }

  /** One file to send to the browser; refused outside the ticket's folders, for a type not listed, or when too large. */
  async open(key: string, relative: string): Promise<BlackboardOpened> {
    const dir = await this.dirOf(key);
    const clean = cleanRelative(relative);
    const sprint = clean && SPRINT.test(clean.split('/')[0]) ? (await this.sprintTickets()).get(String(key || '').trim().toUpperCase()) : undefined;
    const base = sprint?.files.some((file) => file.path === clean) ? this.sprintRoot : dir;
    if (!base) throw new BlackboardRefusal(404, 'No blackboard for this ticket');
    if (!clean) throw new BlackboardRefusal(400, 'Bad file path');
    const realDir = await fs.realpath(base);
    const real = await fs.realpath(path.join(base, clean)).catch(() => null);
    if (!real || !inside(realDir, real)) throw new BlackboardRefusal(404, 'No such file');
    const stat = await fs.stat(real);
    if (!stat.isFile()) throw new BlackboardRefusal(404, 'No such file');
    const ext = extOf(real);
    const mime = TEXT_TYPES[ext] ?? MEDIA_TYPES[ext];
    if (!mime) throw new BlackboardRefusal(415, 'This file type is not shown');
    if (stat.size > (TEXT_TYPES[ext] ? MAX_TEXT_BYTES : MAX_MEDIA_BYTES)) throw new BlackboardRefusal(413, 'File too large to show');
    return { file: real, size: stat.size, mime, name: path.basename(real), inline: true };
  }

  private async dirOf(key: string): Promise<string | null> {
    const upper = String(key || '').trim().toUpperCase();
    if (!TICKET_KEY.test(upper)) return null;
    const direct = path.join(this.root, upper);
    if (await isDir(direct)) return direct;
    const boards = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const board of boards) {
      if (!board.isDirectory() || !TICKET_KEY.test(board.name)) continue;
      const nested = path.join(this.root, board.name, 'tickets', upper);
      if (await isDir(nested)) return nested;
    }
    return null;
  }

  /** The tickets of the sprint boards: a file whose name carries the key, or everything under a folder named by the key. */
  private async sprintTickets(): Promise<Map<string, SprintTicket>> {
    const found = new Map<string, SprintTicket>();
    const sprints = await fs.readdir(this.sprintRoot, { withFileTypes: true }).catch(() => []);
    for (const sprint of sprints) {
      if (!sprint.isDirectory() || !SPRINT.test(sprint.name)) continue;
      const epics = await fs.readdir(path.join(this.sprintRoot, sprint.name), { withFileTypes: true }).catch(() => []);
      for (const epic of epics) {
        if (!epic.isDirectory() || epic.name.startsWith('.')) continue;
        const prefix = `${sprint.name}/${epic.name}`;
        for (const file of await this.walk(path.join(this.sprintRoot, sprint.name, epic.name), false)) {
          const parts = file.path.split('/');
          const key = parts.slice(0, -1).find((part) => TICKET_KEY.test(part)) ?? KEY_IN_NAME.exec(parts[parts.length - 1])?.[1];
          if (!key) continue;
          const ticket = found.get(key) ?? { epic: `${sprint.name} · ${epic.name}`, files: [] };
          ticket.files.push({ ...file, path: `${prefix}/${file.path}`, generated: false });
          found.set(key, ticket);
        }
      }
    }
    return found;
  }

  private async summary(key: string, epic: string | null, dir: string): Promise<BlackboardTicket> {
    const files = await this.walk(dir);
    const updatedAt = files.reduce((latest, file) => (file.updatedAt > latest ? file.updatedAt : latest), '');
    return { key, epic, updatedAt: updatedAt || (await fs.stat(dir)).mtime.toISOString(), files: files.length };
  }

  private async walk(dir: string, ledger = true): Promise<BlackboardFile[]> {
    const out: BlackboardFile[] = [];
    const visit = async (folder: string, prefix: string, depth: number) => {
      if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
      const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (out.length >= MAX_FILES || entry.name.startsWith('.')) continue;
        // An epic board's tickets are listed as their own entries.
        if (ledger && depth === 0 && entry.name === 'tickets' && entry.isDirectory()) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) await visit(full, relative, depth + 1);
        else if (entry.isFile()) {
          const stat = await fs.stat(full);
          out.push({ path: relative, size: stat.size, updatedAt: stat.mtime.toISOString(), kind: fileKind(entry.name), generated: depth === 0 && GENERATED.has(entry.name) });
        }
      }
    };
    await visit(dir, '', 0);
    return out;
  }
}

async function isDir(target: string) {
  return fs.stat(target).then((stat) => stat.isDirectory(), () => false);
}

export const blackboard = new Blackboard();
