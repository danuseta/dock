import { hunkEnd, type Hunk } from './patch';

/** Where each review finding sits in a pull request's diff, read from the path:line tokens in its text. */

export interface ChangesFinding { at: string; severity: string; text: string; resolvedAt: string | null; resolvedWhy: string | null }
export interface FileHunks { path: string; hunks: Hunk[] }
export interface Anchor {
  /** Index of the finding in the review. */
  finding: number;
  /** The diff file, or null for General. */
  path: string | null;
  /** The new-side line it sits under; null sits at the top of the file. */
  line: number | null;
  /** The line the text names, also when it is outside the diff. */
  named: number | null;
  /** 1-based place among the anchors of the same finding, and how many there are. */
  part: number;
  parts: number;
  open: boolean;
}
export interface Anchored { anchors: Anchor[]; counts: Record<string, { open: number; total: number }> }

/** The key of General in `counts`. */
export const GENERAL = '';

// A path with an extension and an optional :line or :from-to, or a bare :line that refers to the path before it.
const TOKEN = /([\w.-]*[\w-]\/)*[\w-][\w.-]*\.[A-Za-z]\w*(?::(\d+)(?:-\d+)?)?|(?<=^|[\s,;(]):(\d+)(?:-\d+)?/g;

/** The path:line tokens of a finding's text, a bare :line taking the path before it. */
export function tokensOf(text: string): Array<{ path: string; line: number | null }> {
  const tokens: Array<{ path: string; line: number | null }> = [];
  let last: string | null = null;
  for (const match of text.matchAll(TOKEN)) {
    if (match[3]) {
      if (last) tokens.push({ path: last, line: Number(match[3]) });
      continue;
    }
    const path = match[0].replace(/:\d+(?:-\d+)?$/, '');
    last = path;
    tokens.push({ path, line: match[2] ? Number(match[2]) : null });
  }
  return tokens;
}

const endsWithPath = (file: string, token: string) => file === token || file.endsWith(`/${token}`);

export function anchorFindings(files: FileHunks[], findings: ChangesFinding[]): Anchored {
  const place = new Map(files.map((file, index) => [file.path, index]));
  const anchors: Anchor[] = [];
  findings.forEach((finding, index) => {
    const spots: Array<{ path: string | null; line: number | null; named: number | null }> = [];
    for (const token of tokensOf(finding.text)) {
      const file = files.find((item) => endsWithPath(item.path, token.path));
      if (!file) continue;
      const inside = token.line !== null && file.hunks.some((hunk) => token.line! >= hunk.newStart && token.line! <= hunkEnd(hunk));
      const spot = { path: file.path, line: inside ? token.line : null, named: token.line };
      if (!spots.some((item) => item.path === spot.path && item.line === spot.line)) spots.push(spot);
    }
    if (!spots.length) spots.push({ path: null, line: null, named: null });
    spots.forEach((spot, part) => anchors.push({ finding: index, ...spot, part: part + 1, parts: spots.length, open: !finding.resolvedAt }));
  });
  // General first, then the files in diff order, the top of a file before its lines.
  const rank = (anchor: Anchor) => (anchor.path === null ? -1 : place.get(anchor.path) ?? 0);
  anchors.sort((a, b) => rank(a) - rank(b) || (a.line ?? 0) - (b.line ?? 0) || a.finding - b.finding);
  const counts: Anchored['counts'] = {};
  for (const anchor of anchors.filter((item) => item.part === 1)) {
    const key = anchor.path ?? GENERAL;
    const count = counts[key] ?? { open: 0, total: 0 };
    count.total += 1;
    if (anchor.open) count.open += 1;
    counts[key] = count;
  }
  return { anchors, counts };
}
