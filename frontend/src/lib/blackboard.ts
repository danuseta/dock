import { useEffect, useState } from 'react';

export type BlackboardFileKind = 'text' | 'image' | 'video' | 'other';
export interface BlackboardTicket { key: string; epic: string | null; updatedAt: string; files: number }
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

export interface ExecutionLogEntry { at: string; kind: string; head: string; text: string }
interface RunEvent { id: string; kind: string; detail: string | null; at: string }

/** The kinds the run's timeline log already carries; every other event (LGTM, Jira, a reset) is added from the event list. */
const LOGGED_KINDS = new Set(['STAGE', 'WAITING', 'RESUMED', 'MACHINE']);

/** The execution log of one ticket: the timeline log (stages, gates, agents and tools) and the other events, newest first. */
export function executionLog(log: ExecutionLogEntry[], events: RunEvent[]): ExecutionLogEntry[] {
  const extra = events.filter((event) => !LOGGED_KINDS.has(event.kind))
    .map((event) => ({ at: event.at, kind: event.kind.includes('FAIL') ? 'fail' : event.kind === 'APPROVED' ? 'ok' : 'event', head: event.kind.toLowerCase().replace(/_/g, ' '), text: event.detail ?? '' }));
  return [...log, ...extra].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
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
