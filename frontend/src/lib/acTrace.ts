import { useEffect, useState } from 'react';

/** Tiket → kode as the blackboard API reads it from the ticket's board: AC lines, their task, path:line, tests and pull requests. */
export type AcSide = 'be' | 'fe';
export interface AcRef { path: string; line: number | null; end: number | null; text: string; side: AcSide | null }
export interface AcTask { id: string; title: string | null; done: boolean }
export interface AcTraceLine {
  n: number; label: string; group: string | null; text: string | null; state: 'PASS' | 'FAIL' | 'TODO' | null;
  tasks: AcTask[]; refs: AcRef[]; tests: string[]; prs: string[]; note: string | null;
  /** The Indonesian line the planning summary wrote for this AC line; set on the page, not by the API. */
  textId?: string | null;
}
export interface AcTracePull { side: AcSide | null; url: string; label: string }
export interface AcTrace { key: string; readable: boolean; total: number; covered: number; lines: AcTraceLine[]; pulls: AcTracePull[]; sources: string[]; formats: string[] }

/** What the page says where there is nothing it can read. */
export const NOTHING_YET = 'belum ada';

export const hasCode = (line: AcTraceLine) => line.refs.some((ref) => ref.line !== null);

/** "25/26", or "belum ada" when the board has no AC lines this DOCK can read. */
export const coverageText = (trace: AcTrace | null | undefined) => (trace?.readable && trace.total > 0 ? `${trace.covered}/${trace.total}` : NOTHING_YET);

/** The AC lines without a path:line, for the "cuma yang belum" filter. */
export const missingOnly = (lines: AcTraceLine[]) => lines.filter((line) => !hasCode(line));

/** The lines grouped the way sous grouped them (FE / BE, or one group), in board order. */
export function traceGroups(lines: AcTraceLine[]): Array<{ group: string | null; lines: AcTraceLine[] }> {
  const groups: Array<{ group: string | null; lines: AcTraceLine[] }> = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.group === line.group) last.lines.push(line);
    else groups.push({ group: line.group, lines: [line] });
  }
  return groups;
}

/** The summary's Indonesian lines go beside the AC lines only when they were written for the same AC, one per line. */
export function withIndonesian(trace: AcTrace, summary: { acId: string[]; current: boolean } | null | undefined): AcTrace {
  const ids = summary?.current && summary.acId.length === trace.lines.length ? summary.acId : null;
  return { ...trace, lines: trace.lines.map((line, index) => ({ ...line, textId: ids?.[index]?.trim() || null })) };
}

/** A diff file that a path:line names: the same path, or the path the reviewer shortened. */
export const refMatches = (ref: AcRef, filePath: string) => filePath === ref.path || filePath.endsWith(`/${ref.path}`) || ref.path.endsWith(`/${filePath}`);

const BASE = '/api/blackboard';

/** Null when the ticket has no blackboard; an unreadable trace when it has one this DOCK cannot read. */
export async function fetchAcTrace(key: string): Promise<AcTrace | null> {
  const response = await fetch(`${BASE}/${encodeURIComponent(key)}/ac-trace`, { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Blackboard answered ${response.status}`);
  return ((await response.json()) as { trace: AcTrace }).trace;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

/**
 * Asks every view of the ticket's Tiket → kode to read it again. The checkpoints of QRD-1534 call this when the
 * lead writes one; until then the views also read it again on their poll.
 */
export function refreshAcTrace(key: string) {
  for (const listener of listeners.get(key.toUpperCase()) ?? []) listener();
}

export const AC_TRACE_POLL_MS = 30000;

/** The ticket's trace, read again on each poll and on refreshAcTrace; null while loading, when off, or when it has none. */
export function useAcTrace(key: string | null | undefined, enabled: boolean, pollMs = AC_TRACE_POLL_MS): AcTrace | null {
  const [trace, setTrace] = useState<AcTrace | null>(null);
  useEffect(() => {
    setTrace(null);
    if (!key || !enabled) return undefined;
    let gone = false;
    const load = () => { fetchAcTrace(key).then((found) => { if (!gone) setTrace(found); }, () => undefined); };
    load();
    const upper = key.toUpperCase();
    const set = listeners.get(upper) ?? new Set<Listener>();
    set.add(load);
    listeners.set(upper, set);
    const timer = pollMs > 0 ? window.setInterval(load, pollMs) : null;
    return () => {
      gone = true;
      set.delete(load);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [key, enabled, pollMs]);
  return trace;
}
