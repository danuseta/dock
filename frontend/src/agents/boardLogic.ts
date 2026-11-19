// The pure side of Planning > Draft > Team map > Board: a lane per developer with the cards still to build and the new tickets.
import { UNASSIGNED, countedNewTickets, newTicketNeedsWork, pendingNewTickets, uncheckedStoryboard, undecidedFinding, unrecordedEpics, type DraftFinding, type DraftNewTicket, type NewTicketInput, type PlanningPanel, type SprintDraft } from './planning';

export type BoardFilter = 'all' | 'ac' | 'sb' | 'new';
export type TeamView = 'board' | 'schedule';

export interface BoardCard {
  key: string; summary: string; dev: string | null; sp: number | null; status: string; epic: string | null;
  isNew: boolean; type: string | null; createdKey: string | null;
  /** ac: an AC line names another ticket and is not decided. sb: the epic's storyboard is not recorded, or the AC waits on a storyboard check. */
  flags: { ac: boolean; sb: boolean };
}
export interface BoardLane { dev: string; load: number; share: number; over: boolean; cards: BoardCard[] }

const sum = (values: Array<number | null | undefined>) => Math.round(values.reduce<number>((total, value) => total + (value ?? 0), 0) * 10) / 10;

type BoardDraft = Pick<SprintDraft, 'tickets' | 'newTickets' | 'findings' | 'storyboards' | 'devs'>;

/** Every card of the board: the open tickets in schedule order, then the new tickets not loaded from Jira yet. */
export function boardCards(draft: Omit<BoardDraft, 'devs'>): BoardCard[] {
  const undecided = new Set(draft.findings.filter(undecidedFinding).map((finding) => finding.key));
  const unrecorded = new Set(unrecordedEpics(draft));
  const tickets = [...draft.tickets]
    .sort((a, b) => a.start - b.start || a.key.localeCompare(b.key, undefined, { numeric: true }))
    .map((ticket): BoardCard => ({
      key: ticket.key, summary: ticket.summary, dev: ticket.dev, sp: ticket.left ?? ticket.sp, status: ticket.status, epic: ticket.epic, isNew: false, type: null, createdKey: null,
      flags: { ac: undecided.has(ticket.key), sb: (!!ticket.epic && unrecorded.has(ticket.epic)) || (!!ticket.storyboard && !ticket.storyboard.checked) },
    }));
  const fresh = countedNewTickets(draft).map((item): BoardCard => ({
    key: item.id, summary: item.summary, dev: item.dev, sp: item.sp, status: item.createdKey ? `created ${item.createdKey}` : 'new', epic: item.epic, isNew: true, type: item.type, createdKey: item.createdKey,
    flags: { ac: false, sb: false },
  }));
  return [...tickets, ...fresh];
}

/** One lane per developer in the draft's order, any other named developer after, and Unassigned last when a card has none. */
export function boardLanes(draft: BoardDraft, perDev: number): BoardLane[] {
  const cards = boardCards(draft);
  const names = [...new Set([...draft.devs, ...cards.flatMap((card) => (card.dev ? [card.dev] : []))])];
  const lanes = names.map((dev) => {
    const mine = cards.filter((card) => card.dev === dev);
    const load = sum(mine.map((card) => card.sp));
    return { dev, load, share: perDev, over: load > perDev, cards: mine };
  });
  const loose = cards.filter((card) => !card.dev);
  return loose.length ? [...lanes, { dev: UNASSIGNED, load: sum(loose.map((card) => card.sp)), share: 0, over: false, cards: loose }] : lanes;
}

/** A card the filter keeps bright; the others are dimmed, never hidden. */
export const cardShown = (card: Pick<BoardCard, 'flags' | 'isNew'>, filter: BoardFilter) => (filter === 'ac' ? card.flags.ac : filter === 'sb' ? card.flags.sb : filter === 'new' ? card.isNew : true);

/** How many cards each filter keeps. */
export const filterCounts = (cards: BoardCard[]) => ({ ac: cards.filter((card) => card.flags.ac).length, sb: cards.filter((card) => card.flags.sb).length, new: cards.filter((card) => card.isNew).length });

const outsideKind = (kind: string) => kind !== 'after-it' && kind !== 'lands-first';

/** A ticket's undecided AC lines that name a ticket outside the plan: what "All N outside plan → Reference" decides. */
export const outsidePlanOpen = (findings: DraftFinding[], key: string) => findings.filter((finding) => finding.key === key && outsideKind(finding.kind) && undecidedFinding(finding));

/** The findings grouped by ticket, in the order they first appear. */
export function findingGroups(findings: DraftFinding[]): Array<{ key: string; findings: DraftFinding[] }> {
  const groups = new Map<string, DraftFinding[]>();
  for (const finding of findings) groups.set(finding.key, [...(groups.get(finding.key) ?? []), finding]);
  return [...groups].map(([key, rows]) => ({ key, findings: rows }));
}

/** An AC line cut around every mention of the named ticket, so the row can highlight it. */
export function keyParts(text: string, key: string): Array<{ text: string; hit: boolean }> {
  if (!key) return [{ text, hit: false }];
  const pattern = new RegExp(`(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?!\\d)`, 'gi');
  return text.split(pattern).filter(Boolean).map((part) => ({ text: part, hit: part.toLowerCase() === key.toLowerCase() }));
}

/** The count badge of a panel tab; 0 shows no badge. */
export function panelBadge(panel: PlanningPanel, draft: Pick<SprintDraft, 'tickets' | 'newTickets' | 'findings' | 'storyboards'>): number {
  if (panel === 'ac') return draft.findings.filter(undecidedFinding).length;
  if (panel === 'storyboard') return unrecordedEpics(draft).length + draft.tickets.filter((ticket) => !ticket.carried && ticket.storyboard && !ticket.storyboard.checked).length;
  if (panel === 'new') return (draft.newTickets ?? []).filter((item) => !item.createdKey).length;
  return 0;
}

/** The chips of the bottom bar: what is still open per panel, from the same counts as the readiness. */
export function barIssues(draft: Pick<SprintDraft, 'tickets' | 'newTickets' | 'findings' | 'storyboards'>) {
  const ac = draft.findings.filter(undecidedFinding).length;
  const epics = unrecordedEpics(draft).length;
  const checks = uncheckedStoryboard({ tickets: draft.tickets.filter((ticket) => !ticket.carried) }).length;
  const fresh = pendingNewTickets(draft);
  return { ac, epics, checks, fresh: fresh.length, needWork: fresh.filter(newTicketNeedsWork).length };
}

export const NEW_TICKET_LIMIT = 30;
export const TICKET_TYPES = ['Task', 'Story', 'Bug'];
export const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

/** A new ticket as its edit form holds it: every field as text, AC one line per row. */
export interface NewTicketForm { summary: string; type: string; epic: string; dev: string; sp: string; priority: string; userStory: string; problem: string; ac: string; reference: string }

export const newTicketForm = (item: DraftNewTicket | null): NewTicketForm => ({
  summary: item?.summary ?? '', type: item?.type ?? 'Task', epic: item?.epic ?? '', dev: item?.dev ?? '', sp: item?.sp === null || item?.sp === undefined ? '' : String(item.sp),
  priority: item?.priority ?? 'Medium', userStory: item?.userStory ?? '', problem: item?.problem ?? '', ac: (item?.ac ?? []).join('\n'), reference: item?.reference ?? '',
});

/** The form as the save mutation takes it; error names the field that does not read. */
export function newTicketInput(form: NewTicketForm): { input: NewTicketInput; error: string | null } {
  const sp = form.sp.trim() === '' ? null : Number(form.sp);
  const ac = form.ac.split('\n').map((line) => line.trim()).filter(Boolean);
  const input: NewTicketInput = {
    summary: form.summary.trim(), type: TICKET_TYPES.includes(form.type) ? form.type : 'Task', epic: form.epic.trim().toUpperCase() || null, dev: form.dev || null,
    sp, priority: PRIORITIES.includes(form.priority) ? form.priority : 'Medium', userStory: form.userStory.trim(), problem: form.problem.trim(), ac, reference: form.reference.trim() || null,
  };
  if (!input.summary) return { input, error: 'Write a summary' };
  if (sp !== null && (!Number.isFinite(sp) || sp < 0 || sp > 100)) return { input, error: 'SP is a number from 0 to 100' };
  if (input.epic && !/^[A-Z][A-Z0-9]*-\d+$/.test(input.epic)) return { input, error: 'Epic is a key such as QRD-1531' };
  if (ac.length > 40) return { input, error: 'At most 40 AC lines' };
  return { input, error: null };
}

const VIEWS: TeamView[] = ['board', 'schedule'];
const FOLDED = '1';

/** The Team map view a stored value names; Board when nothing valid is stored. */
export const teamViewOf = (stored: string | null): TeamView => (VIEWS.includes(stored as TeamView) ? stored as TeamView : 'board');

/** The chat column is folded only when it was folded last time. */
export const chatFoldedOf = (stored: string | null) => stored === FOLDED;
export const chatFoldedValue = (folded: boolean) => (folded ? FOLDED : '0');

export const TEAM_VIEW_KEY = 'dock-planning-team-view';
export const CHAT_FOLDED_KEY = 'dock-planning-chat-folded';

/** Reads a remembered choice; storage can be missing or blocked. */
export function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Without storage the choice only lasts until reload.
  }
}
