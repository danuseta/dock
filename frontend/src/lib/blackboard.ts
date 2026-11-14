import { useEffect, useState } from 'react';

export type BlackboardFileKind = 'text' | 'image' | 'video' | 'other';
export type BlackboardKind = 'task' | 'review';
export interface BlackboardTicket { key: string; epic: string | null; updatedAt: string; files: number; sprint?: string | null; kind?: BlackboardKind }
export interface BlackboardFile { path: string; size: number; updatedAt: string; kind: BlackboardFileKind; generated: boolean }

const BASE = '/api/blackboard';

/** The files the owner reads first, in this order; everything else follows by path. */
const FIRST = ['NOW.md', 'review.md', 'decisions.md', 'issues.md', 'status.md'];

export const blackboardHref = (key: string) => `/blackboard?key=${encodeURIComponent(key)}`;
export const blackboardFileHref = (key: string, path: string) => `${blackboardHref(key)}&file=${encodeURIComponent(path)}`;
export const fileUrl = (key: string, path: string, download = false) => `${BASE}/${encodeURIComponent(key)}/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`;

export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '');

export function sortFiles(files: BlackboardFile[]): BlackboardFile[] {
  const rank = (file: BlackboardFile) => {
    const at = FIRST.indexOf(file.path);
    return at >= 0 ? at : FIRST.length;
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Top-level files, then one entry per folder with the files inside it. */
export function groupFiles(files: BlackboardFile[]): Array<{ folder: string; files: BlackboardFile[] }> {
  const groups = new Map<string, BlackboardFile[]>();
  for (const file of sortFiles(files)) groups.set(folderOf(file.path), [...(groups.get(folderOf(file.path)) ?? []), file]);
  return [...groups].map(([folder, list]) => ({ folder, files: list })).sort((a, b) => (a.folder === '' ? -1 : b.folder === '' ? 1 : a.folder < b.folder ? -1 : 1));
}

/** The "generated, do not edit" marker status.cjs puts on top is an HTML comment; the page says it in its own note. */
export const withoutComments = (text: string) => text.replace(/<!--[\s\S]*?-->\s*/g, '');

/** The Log entry of the file list: the run's execution log, not a file on the board. */
export const LOG_ENTRY = '@log';
/** Generated entries of the Dokumen folder: Tiket → kode and the contract, read from the board, not files on it. */
export const TRACE_ENTRY = '@trace';
export const CONTRACT_ENTRY = '@contract';
/** The pronunciation list at the blackboard root. */
export const KAMUS_ENTRY = '@kamus';
export const KAMUS_FILE = 'kamus-pengucapan.md';
/** Perubahan kode of one repository's pull request; the old Changes page opens here. */
export const pullEntry = (repo: string | null) => `pr:${repo ?? ''}`;
export const isPullEntry = (entry: string | null | undefined) => Boolean(entry?.startsWith('pr:'));
export const pullRepo = (entry: string | null) => (entry?.startsWith('pr:') ? entry.slice(3) || null : null);

/** Files that hold the ticket's contract: the copy sous saved under materials/, newest first. */
export function contractFiles(files: BlackboardFile[]): BlackboardFile[] {
  return files.filter((file) => /(^|\/)contract[^/]*\.md$/i.test(file.path)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface BoardTree { docs: BlackboardFile[]; artifacts: Array<{ folder: string; files: BlackboardFile[] }>; other: Array<{ folder: string; files: BlackboardFile[] }> }

const ARTIFACT_FOLDER = /^(screenshots|materials|demo|video|videos|narasi|storyboard|replay|artifacts|shots)$/i;

/** One ticket's folders as the page draws them: Dokumen (the top files), Artifacts (screenshots, materials, video), then the rest. */
export function boardTree(files: BlackboardFile[]): BoardTree {
  const groups = groupFiles(files);
  return {
    docs: groups.find((group) => group.folder === '')?.files ?? [],
    artifacts: groups.filter((group) => group.folder && (ARTIFACT_FOLDER.test(group.folder) || group.files.every((file) => file.kind !== 'text'))),
    other: groups.filter((group) => group.folder && !(ARTIFACT_FOLDER.test(group.folder) || group.files.every((file) => file.kind !== 'text'))),
  };
}

export type BoardFilter = 'all' | 'task' | 'review';
export const NO_SPRINT = 'Tanpa sprint';

/** The ticket list per sprint, newest sprint first, filtered to Task or Review boards. */
export function sprintGroups(tickets: BlackboardTicket[], filter: BoardFilter, sprintOf: (ticket: BlackboardTicket) => string | null = (ticket) => ticket.sprint ?? null, kindOf: (ticket: BlackboardTicket) => BlackboardKind = (ticket) => ticket.kind ?? 'task'): Array<{ sprint: string; tickets: BlackboardTicket[] }> {
  const groups = new Map<string, BlackboardTicket[]>();
  for (const ticket of tickets) {
    if (filter !== 'all' && kindOf(ticket) !== filter) continue;
    const sprint = sprintOf(ticket) || NO_SPRINT;
    groups.set(sprint, [...(groups.get(sprint) ?? []), ticket]);
  }
  const number = (name: string) => Number(/(\d+)\s*$/.exec(name)?.[1] ?? -1);
  return [...groups].map(([sprint, list]) => ({ sprint, tickets: list })).sort((a, b) => (a.sprint === NO_SPRINT ? 1 : b.sprint === NO_SPRINT ? -1 : number(b.sprint) - number(a.sprint) || a.sprint.localeCompare(b.sprint)));
}


export const formatSize =(bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Blackboard answered ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const fetchTickets = () => getJson<{ tickets: BlackboardTicket[] }>(`${BASE}/tickets`).then((body) => body.tickets);
/** A file at the blackboard root; null when it is not there. */
export const fetchRootText = (name: string) => fetch(`${BASE}/root/${encodeURIComponent(name)}`, { credentials: 'same-origin', cache: 'no-store' })
  .then((response) => (response.ok ? response.text() : null), () => null);
/** Null when the ticket has no blackboard folder. */
export const fetchFiles = (key: string) => fetch(`${BASE}/${encodeURIComponent(key)}/files`, { credentials: 'same-origin', cache: 'no-store' })
  .then(async (response) => (response.status === 404 ? null : response.ok ? ((await response.json()) as { files: BlackboardFile[] }).files : Promise.reject(new Error(`Blackboard answered ${response.status}`))));
export const fetchText = (key: string, path: string) => fetch(fileUrl(key, path), { credentials: 'same-origin', cache: 'no-store' })
  .then(async (response) => (response.ok ? response.text() : Promise.reject(new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || `Blackboard answered ${response.status}`))));

/** A ticket's blackboard files for the ticket detail page and the Agents panel; null while loading or when there is none. */
export function useBlackboardFiles(key: string | null | undefined, enabled: boolean): BlackboardFile[] | null {
  const [files, setFiles] = useState<BlackboardFile[] | null>(null);
  useEffect(() => {
    setFiles(null);
    if (!key || !enabled) return undefined;
    let gone = false;
    fetchFiles(key).then((found) => { if (!gone) setFiles(found); }, () => { if (!gone) setFiles(null); });
    return () => { gone = true; };
  }, [key, enabled]);
  return files;
}
