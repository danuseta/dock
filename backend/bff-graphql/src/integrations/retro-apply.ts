// Accepting a retro line, by the owner or by DOCK. A line with somewhere to go opens a sous session that applies it; a
// note or a QA bot line is only marked accepted. Ledger lines of a new draft are accepted without the owner; Judge
// lines wait for the owner.
import { MANUAL_DESTS, retroApplyPrompt } from './retro';

export interface RetroLine { id: string; sprint: string; kind: string; text: string; evidence: string; dest: string; status: string; sessionId: string | null; source?: string | null }

export interface RetroApplyDeps<T extends RetroLine = RetroLine> {
  update(id: string, data: { status: string; sessionId: string | null }): Promise<T>;
  /** Runs one sous prompt and answers its session: a new session, or the next turn of `into` when it is given. */
  run(title: string, text: string, into: string | null): Promise<string>;
}

const evidenceOf = (raw: string) => {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};

export const retroApplyTitle = (sprint: string) => `Retro-apply-${sprint}`;

/** Marks the line accepted; one with somewhere to go first asks sous to apply it, in a new session or as the next turn of `into`. */
export async function acceptRetroLine<T extends RetroLine>(item: T, deps: RetroApplyDeps<T>, into: string | null = null): Promise<T> {
  const sessionId = MANUAL_DESTS.includes(item.dest)
    ? null
    : await deps.run(retroApplyTitle(item.sprint), retroApplyPrompt({ id: item.id, text: item.text, dest: item.dest, evidence: evidenceOf(item.evidence) }), into);
  return deps.update(item.id, { status: 'accepted', sessionId });
}

const sameLine = (a: RetroLine, b: RetroLine) => a.kind === b.kind && a.dest === b.dest && a.text.trim().toLowerCase() === b.text.trim().toLowerCase();

/**
 * The ledger lines a draft just stored are accepted without the owner. A Try line goes through acceptRetroLine; every Try
 * line of the draft that opens a session goes to the same session, one turn after another. Keep and Problem lines only
 * inform, so they are marked accepted with no session. A line the sprint already accepted, drafted again, is marked
 * accepted with the earlier session and is not applied twice. Judge lines are left open. A line that cannot be applied
 * stays open for the owner. Answers the accepted lines.
 */
export async function autoAcceptLedgerLines<T extends RetroLine>(created: T[], earlier: T[], deps: RetroApplyDeps<T>, failed: (item: T, error: unknown) => void = () => undefined): Promise<T[]> {
  const accepted: T[] = [];
  let into: string | null = null;
  for (const item of created) {
    if ((item.source ?? 'ledger') !== 'ledger' || item.status !== 'open') continue;
    const before = earlier.find((other) => other.status === 'accepted' && sameLine(other, item));
    try {
      if (before) accepted.push(await deps.update(item.id, { status: 'accepted', sessionId: before.sessionId }));
      else if (item.kind !== 'try') accepted.push(await deps.update(item.id, { status: 'accepted', sessionId: null }));
      else {
        const row: T = await acceptRetroLine(item, deps, into);
        into = row.sessionId ?? into;
        accepted.push(row);
      }
    } catch (error) {
      failed(item, error);
    }
  }
  return accepted;
}
