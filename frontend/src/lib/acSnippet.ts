import { repoName } from '../changes/href';
import { parsePatch, type DiffLine } from '../changes/patch';
import { refMatches, type AcRef, type AcTracePull } from './acTrace';

/** A changed file of one of the ticket's pull requests, as Perubahan kode loads it from GitHub. */
export interface PullPatch { repo: string; path: string; patch: string | null }
export interface SnippetLine extends DiffLine { hit: boolean }

const repoOf = (ref: AcRef, pulls: AcTracePull[]) => {
  const pull = ref.side ? pulls.find((item) => item.side === ref.side) : null;
  return pull ? repoName(pull.url) : null;
};

/**
 * How a path:line reads on the page: the full path the verdict's legend gives an alias (svc:239 → src/services/x.ts:239),
 * with the repository in front when the side is known. The alias as written stays as the tooltip.
 */
export function refDisplay(ref: AcRef, pulls: AcTracePull[]): { label: string; title: string | null } {
  const lines = ref.line === null ? '' : `:${ref.line}${ref.end ? `-${ref.end}` : ''}`;
  const repo = repoOf(ref, pulls);
  const label = `${repo ? `${repo}/` : ''}${ref.path}${lines}`;
  return { label, title: label === ref.text ? null : ref.text };
}

/** The lines of the diff hunk around a path:line, `radius` on each side; null when the line is not in a hunk. */
export function snippetAround(patch: string | null, line: number | null, radius = 5): SnippetLine[] | null {
  if (line === null || !patch) return null;
  for (const hunk of parsePatch(patch)) {
    const at = hunk.lines.findIndex((item) => item.newLine === line);
    if (at < 0) continue;
    return hunk.lines.slice(Math.max(0, at - radius), at + radius + 1).map((item) => ({ ...item, hit: item.newLine === line }));
  }
  return null;
}

/** The diff file a path:line names, in the repository of its side when that is known. */
export function patchFor(ref: AcRef, files: PullPatch[], pulls: AcTracePull[]): PullPatch | null {
  const repo = repoOf(ref, pulls);
  return files.find((file) => (!repo || file.repo === repo) && refMatches(ref, file.path)) ?? null;
}
