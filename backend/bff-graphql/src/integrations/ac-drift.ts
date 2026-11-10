// AC drift in Agents > Sprint > Plan: once a sprint is published, an AC line of one of the owner's tickets that needs a
// ticket which has not landed (it lands after this one, or it slipped past its planned day) is Held. The owner then moves
// the line to the ticket that builds it, marks it not tested here, keeps it waiting, or flags it for the PO. AC is only
// written on tickets assigned to the owner, and only when Jira still holds the AC the plan published.
import { acFindings, findingId, isDoneStatus, normalizeAcLine } from './ac-scope';
import type { PlanningIssue } from './jira-sprint';
import { SprintInputError } from './sprint-dashboard';
import { acValueLines, openTickets, rewriteAcValue, type DraftJira, type DraftStore, type DraftView } from './sprint-draft';
import { workingDayOf } from './scope-cut';
import { MOVE_MARKER, MOVE_PENDING_LABEL, moveAnswer, moveId, type AcMoveJira } from './ac-move';

export const DRIFT_ACTIONS = ['move', 'not-tested', 'wait', 'needs-po', 'clear'] as const;
export { MOVE_PENDING_LABEL };
export type DriftAction = typeof DRIFT_ACTIONS[number];
export type DriftState = 'held' | 'moved' | 'move-pending' | 'move-accepted' | 'not-tested' | 'wait' | 'needs-po';

/** moveId names the QONFLO-AC-MOVE request a move to a teammate's ticket is waiting on. */
export interface DriftDecision { action: Exclude<DriftAction, 'clear'>; state: DriftState; note: string | null; by: string | null; at: string; moveId?: string }
export interface DriftRow {
  id: string; key: string; line: number; text: string; refKey: string; refStatus: string | null; refDev: string | null;
  refEnd: number | null; ownEnd: number | null; reason: 'after-it' | 'slipped' | 'outside-plan'; state: DriftState; decision: DriftDecision | null;
}
/** An owner ticket naming a storyboard frame that changed since publish. */
export interface DriftStoryboard { key: string; version: number; frames: string[]; held: boolean; checked: boolean }
export interface PlanDrift { sprint: string; publishedAt: string | null; today: number | null; rows: DriftRow[]; storyboard: DriftStoryboard[] }

/** What drift needs from Jira beyond Planning: who DOCK is, comments and labels. */
export interface DriftJira extends Pick<DraftJira, 'statusesOf' | 'issueNow' | 'setAc'>, Pick<AcMoveJira, 'comments' | 'markedComment'> {
  myself(): Promise<string | null>;
  comment(key: string, lines: string[]): Promise<void>;
  addLabel(key: string, label: string): Promise<void>;
}

type DriftStore = Pick<DraftStore, 'getSprintDraft' | 'updateSprintDraftTicket'> & {
  updateSprintDraftDrift(sprint: string, drift: string): Promise<unknown>;
};

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((line, index) => line === b[index]);
const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The working day of the sprint `now` falls on, 1-based, on the +08:00 calendar; null before the start or without one. */
export const sprintDay = (startDate: string | null, now: Date): number | null => workingDayOf(startDate, now, false);

/** The held lines of the owner's tickets in the published plan, with what the owner already did about each. */
export function driftRows(view: DraftView, jiraAc: Map<string, string[]>, ownerKeys: Set<string>, statuses: Map<string, string>, decisions: Record<string, DriftDecision>, today: number | null): DriftRow[] {
  const ends = new Map(view.tickets.map((ticket) => [ticket.key, ticket.end]));
  const devs = new Map(view.tickets.map((ticket) => [ticket.key, ticket.dev]));
  const own = view.tickets.filter((ticket) => ownerKeys.has(ticket.key)).map((ticket) => ({ key: ticket.key, ac: jiraAc.get(ticket.key) ?? ticket.ac }));
  return acFindings(own, ends, (key) => statuses.get(key) ?? null).flatMap((finding): DriftRow[] => {
    const refStatus = statuses.get(finding.refKey) ?? null;
    if (isDoneStatus(refStatus) || isDoneStatus(statuses.get(finding.key))) return [];
    const slipped = finding.refEnd !== null && today !== null && finding.refEnd < today;
    const reason = finding.kind === 'after-it' ? 'after-it' : finding.kind === 'outside-plan' ? 'outside-plan' : slipped ? 'slipped' : null;
    if (!reason) return [];
    const decision = decisions[finding.id] ?? null;
    return [{
      id: finding.id, key: finding.key, line: finding.line, text: finding.text, refKey: finding.refKey, refStatus, refDev: devs.get(finding.refKey) ?? null,
      refEnd: finding.refEnd, ownEnd: finding.ownEnd, reason, state: decision?.state ?? 'held', decision,
    }];
  }).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }) || a.line - b.line);
}

export class AcDriftService {
  constructor(
    private readonly store: DriftStore,
    private readonly view: (sprint: string) => Promise<DraftView | null>,
    private readonly jira: () => Promise<DriftJira>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async published(sprint: string) {
    const [row, view] = await Promise.all([this.store.getSprintDraft(sprint), this.view(sprint)]);
    if (!row || !view || row.status !== 'published') return null;
    const jiraAc = new Map(row.tickets.map((ticket) => [ticket.key, parse<string[]>(ticket.jiraAc, [])]));
    return { row, view: { ...view, tickets: openTickets(view) }, jiraAc, decisions: parse<Record<string, DriftDecision>>((row as { drift?: string }).drift, {}) };
  }

  /** Null when the sprint was not published from Planning. */
  async drift(sprint: string, ownerKeys: string[]): Promise<PlanDrift | null> {
    const published = await this.published(sprint);
    if (!published) return null;
    const owner = new Set(ownerKeys);
    const keys = new Set<string>();
    for (const ticket of published.view.tickets.filter((item) => owner.has(item.key))) {
      keys.add(ticket.key);
      for (const line of published.jiraAc.get(ticket.key) ?? []) for (const ref of line.match(/\bQRD-\d+\b/gi) || []) keys.add(ref.toUpperCase());
    }
    const statuses = keys.size ? await (await this.jira()).statusesOf([...keys]) : new Map<string, string>();
    if (await this.settleMoves(sprint, published)) return this.drift(sprint, ownerKeys);
    const today = sprintDay(published.view.startDate, this.now());
    return {
      sprint, publishedAt: published.view.publishedAt, today,
      rows: driftRows(published.view, published.jiraAc, owner, statuses, published.decisions, today),
      storyboard: published.view.tickets.filter((ticket) => owner.has(ticket.key) && ticket.storyboard).map((ticket) => ({
        key: ticket.key, version: ticket.storyboard!.version, frames: ticket.storyboard!.frames, held: ticket.storyboard!.held && !isDoneStatus(statuses.get(ticket.key)), checked: !!ticket.storyboard!.checked,
      })),
    };
  }

  /** The owner's call on a held line. Writes to Jira only what the call needs, and refuses when the AC moved. */
  async act(sprint: string, ownerKeys: string[], id: string, action: string, note: string | null, by: string | null): Promise<PlanDrift> {
    if (!(DRIFT_ACTIONS as readonly string[]).includes(action)) throw new SprintInputError('action must be move, not-tested, wait, needs-po or clear');
    const current = await this.drift(sprint, ownerKeys);
    if (!current) throw new SprintInputError(`${sprint} was not published from Planning`);
    const published = (await this.published(sprint))!;
    const decisions = { ...published.decisions };
    if (action === 'clear') {
      delete decisions[id];
      await this.store.updateSprintDraftDrift(sprint, JSON.stringify(decisions));
      return (await this.drift(sprint, ownerKeys))!;
    }
    const row = current.rows.find((item) => item.id === id);
    if (!row) throw new SprintInputError('That AC line is not held any more');
    if (row.decision && row.decision.action !== 'wait' && row.decision.state !== 'held') throw new SprintInputError('That line already has a call; undo it first');
    const text = note?.trim().slice(0, 2000) || null;
    const jira = await this.jira();
    let state: DriftState = action === 'wait' ? 'wait' : action === 'needs-po' ? 'needs-po' : 'not-tested';
    let requestId: string | undefined;
    if (action === 'needs-po') {
      await jira.comment(row.key, [`Needs PO: AC ${row.line} needs ${row.refKey}, which has not landed (${row.refStatus ?? 'unknown status'}).`, `"${row.text}"`, ...(text ? [text] : []), `Planner: ${published.view.createdBy ?? 'unknown'}. Flagged from DOCK by ${by ?? 'the owner'}.`]);
    } else if (action === 'not-tested') {
      const own = await this.ownTicket(jira, row.key, published.jiraAc.get(row.key) ?? []);
      const marked = `${row.text} (not tested here: needs ${row.refKey})`;
      await jira.setAc(row.key, rewriteAcValue(own.acRaw, [row.text], [marked]));
      await this.saveAc(sprint, row.key, published.jiraAc.get(row.key) ?? [], [row.text], [marked]);
      await jira.comment(row.key, [`AC ${row.line} marked not tested here: it needs ${row.refKey}, which has not landed (${row.refStatus ?? 'unknown status'}).`, `"${row.text}"`, ...(text ? [text] : []), `Changed from DOCK by ${by ?? 'the owner'}; contract rule: changes without the PO.`]);
    } else if (action === 'move') {
      const own = await this.ownTicket(jira, row.key, published.jiraAc.get(row.key) ?? []);
      const me = await jira.myself();
      const target = await jira.issueNow(row.refKey);
      if (!target) throw new SprintInputError(`${row.refKey} is gone from Jira`);
      if (sameName(target.assignee, me)) {
        const targetLines = acValueLines(target.acRaw);
        const plannedTarget = published.jiraAc.get(row.refKey);
        if (plannedTarget && !sameLines(targetLines, plannedTarget)) throw new SprintInputError(`The AC of ${row.refKey} changed in Jira since publish; read it and decide again`);
        await jira.setAc(row.key, rewriteAcValue(own.acRaw, [row.text], []));
        await this.saveAc(sprint, row.key, published.jiraAc.get(row.key) ?? [], [row.text], []);
        if (!targetLines.some((line) => normalizeAcLine(line) === normalizeAcLine(row.text))) {
          await jira.setAc(row.refKey, rewriteAcValue(target.acRaw, [], [row.text]));
          if (plannedTarget) await this.saveAc(sprint, row.refKey, plannedTarget, [], [row.text]);
        }
        const trail = `Moved AC ${row.line} from ${row.key} to ${row.refKey}, the ticket that builds what it needs. Changed from DOCK by ${by ?? 'the owner'}; contract rule: changes without the PO.`;
        await jira.comment(row.key, [trail, `"${row.text}"`, ...(text ? [text] : [])]);
        await jira.comment(row.refKey, [trail, `"${row.text}"`, ...(text ? [text] : [])]);
        state = 'moved';
      } else {
        requestId = moveId(row.key, row.refKey, row.text);
        await jira.addLabel(row.refKey, MOVE_PENDING_LABEL);
        // The receiving DOCK reads this comment: the marker line, then the line as JSON.
        await jira.markedComment(row.refKey, MOVE_MARKER, JSON.stringify({ id: requestId, from: row.key, to: row.refKey, line: row.line, text: row.text, by, ...(text ? { note: text } : {}) }, null, 2));
        await jira.comment(row.key, [`AC ${row.line} offered to ${row.refKey} (${target.assignee ?? 'unassigned'}) under label ${MOVE_PENDING_LABEL}; it stays here until accepted.`, `"${row.text}"`]);
        state = 'move-pending';
      }
    }
    // A line marked not tested here reads differently now, so its call is kept under the marked line.
    const kept = state === 'not-tested' ? findingId(row.key, row.refKey, `${row.text} (not tested here: needs ${row.refKey})`) : id;
    decisions[kept] = { action: action as DriftDecision['action'], state, note: text, by, at: this.now().toISOString(), ...(requestId ? { moveId: requestId } : {}) };
    await this.store.updateSprintDraftDrift(sprint, JSON.stringify(decisions));
    return (await this.drift(sprint, ownerKeys))!;
  }

  /**
   * Reads the teammate's answer to each pending move. Accepted: the line leaves the owner's ticket, after reading its AC
   * again (changed AC leaves it for the owner to remove by hand). Declined: the line is Held again with the reason.
   * True when a call changed.
   */
  private async settleMoves(sprint: string, published: { decisions: Record<string, DriftDecision>; jiraAc: Map<string, string[]> }): Promise<boolean> {
    const pending = Object.entries(published.decisions).filter(([, decision]) => decision.state === 'move-pending' && decision.moveId);
    if (!pending.length) return false;
    const jira = await this.jira();
    const decisions = { ...published.decisions };
    let changed = false;
    for (const [id, decision] of pending) {
      const [, from, to, ...rest] = id.split('|');
      const text = rest.join('|');
      const answer = await moveAnswer(jira, to, decision.moveId!);
      if (!answer) continue;
      changed = true;
      const at = this.now().toISOString();
      if (!answer.accepted) {
        decisions[id] = { ...decision, state: 'held', note: `${to} declined${answer.by ? ` (${answer.by})` : ''}: ${answer.reason ?? 'no reason given'}`, at };
        continue;
      }
      try {
        const own = await this.ownTicket(jira, from, published.jiraAc.get(from) ?? []);
        const line = acValueLines(own.acRaw).find((item) => normalizeAcLine(item) === text);
        if (line) {
          await jira.setAc(from, rewriteAcValue(own.acRaw, [line], []));
          await this.saveAc(sprint, from, published.jiraAc.get(from) ?? [], [line], []);
          published.jiraAc.set(from, (published.jiraAc.get(from) ?? []).filter((item) => normalizeAcLine(item) !== text));
          await jira.comment(from, [`${to} accepted this AC line${answer.by ? ` (${answer.by})` : ''}; it is removed here.`, `"${line}"`]);
        }
        decisions[id] = { ...decision, state: 'moved', note: `Accepted by ${to}${answer.by ? ` (${answer.by})` : ''}`, at };
      } catch (error) {
        decisions[id] = { ...decision, state: 'move-accepted', note: `Accepted by ${to}; remove the line from ${from} by hand: ${error instanceof Error ? error.message : String(error)}`, at };
      }
    }
    if (changed) await this.store.updateSprintDraftDrift(sprint, JSON.stringify(decisions));
    return changed;
  }

  /** The owner's ticket as Jira holds it now: refused unless it is assigned to DOCK's Jira user and its AC is the published one. */
  private async ownTicket(jira: DriftJira, key: string, published: string[]): Promise<PlanningIssue> {
    const [now, me] = await Promise.all([jira.issueNow(key), jira.myself()]);
    if (!now) throw new SprintInputError(`${key} is gone from Jira`);
    if (!sameName(now.assignee, me)) throw new SprintInputError(`${key} is not assigned to you in Jira; DOCK writes AC only on your own tickets`);
    if (!sameLines(acValueLines(now.acRaw), published)) throw new SprintInputError(`The AC of ${key} changed in Jira since publish; read it and decide again`);
    return now;
  }

  private async saveAc(sprint: string, key: string, from: string[], removed: string[], added: string[]) {
    const lines = [...from];
    for (const line of removed) {
      const index = lines.findIndex((item) => normalizeAcLine(item) === normalizeAcLine(line));
      if (index >= 0) lines.splice(index, 1);
    }
    await this.store.updateSprintDraftTicket(sprint, key, { jiraAc: [...lines, ...added] });
  }
}
