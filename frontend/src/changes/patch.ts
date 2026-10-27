/** A unified diff patch from GitHub as hunks of numbered lines, for the Changes page. */

export type LineKind = 'context' | 'add' | 'del';
export interface DiffLine { kind: LineKind; oldLine: number | null; newLine: number | null; text: string }
export interface Hunk { header: string; section: string; oldStart: number; oldCount: number; newStart: number; newCount: number; lines: DiffLine[] }

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parsePatch(patch: string | null): Hunk[] {
  if (!patch) return [];
  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split('\n')) {
    const head = HUNK.exec(raw);
    if (head) {
      hunk = {
        header: raw, section: head[5], oldStart: Number(head[1]), oldCount: head[2] === undefined ? 1 : Number(head[2]),
        newStart: Number(head[3]), newCount: head[4] === undefined ? 1 : Number(head[4]), lines: [],
      };
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      hunks.push(hunk);
      continue;
    }
    // "\ No newline at end of file" says nothing about the code.
    if (!hunk || raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) hunk.lines.push({ kind: 'add', oldLine: null, newLine: newLine++, text: raw.slice(1) });
    else if (raw.startsWith('-')) hunk.lines.push({ kind: 'del', oldLine: oldLine++, newLine: null, text: raw.slice(1) });
    else hunk.lines.push({ kind: 'context', oldLine: oldLine++, newLine: newLine++, text: raw.slice(1) });
  }
  return hunks;
}

/** A file over this many changed lines starts folded behind Load diff. */
export const LONG_FILE_LINES = 400;

/** The last new-side line a hunk covers. */
export const hunkEnd = (hunk: Hunk) => hunk.newStart + Math.max(hunk.newCount, 1) - 1;

/** Unchanged lines between hunk `index - 1` and hunk `index` (before the first, from line 1). */
export const gapBefore = (hunks: Hunk[], index: number) => hunks[index].newStart - (index === 0 ? 1 : hunkEnd(hunks[index - 1]) + 1);

export interface SplitRow { left: DiffLine | null; right: DiffLine | null }

/** Rows for split view: a run of deletions sits beside the run of additions after it, row by row. */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.kind === 'context') {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (index < lines.length && lines[index].kind === 'del') dels.push(lines[index++]);
    while (index < lines.length && lines[index].kind === 'add') adds.push(lines[index++]);
    for (let row = 0; row < Math.max(dels.length, adds.length); row += 1) rows.push({ left: dels[row] ?? null, right: adds[row] ?? null });
  }
  return rows;
}

const bare = (text: string) => text.replace(/\s+/g, '');

/**
 * For Hide whitespace: a run of deletions and the run of additions after it that differ only in spaces, line for line,
 * become context lines; any other run stays as it is.
 */
export function hideWhitespace(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].kind === 'context') {
      out.push(lines[index++]);
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (index < lines.length && lines[index].kind === 'del') dels.push(lines[index++]);
    while (index < lines.length && lines[index].kind === 'add') adds.push(lines[index++]);
    const same = dels.length === adds.length && dels.every((line, row) => bare(line.text) === bare(adds[row].text));
    if (same) out.push(...adds.map((line, row) => ({ kind: 'context' as const, oldLine: dels[row].oldLine, newLine: line.newLine, text: line.text })));
    else out.push(...dels, ...adds);
  }
  return out;
}
