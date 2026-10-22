import { questionsOf } from '../decisions/questions';

export interface AttentionItem { id: string; type: string; message: string; ticketKey?: string | null }

/** A sous question waiting on the owner; it is answered on Decisions, not listed with the pull request problems. */
export const isSousQuestion = (item: Pick<AttentionItem, 'type' | 'message'>) => item.type === 'AGENT_ISSUE' || (item.type === 'AGENT_WAITING' && /^Waiting on you: I-\d+:/.test(item.message));

/** What Home lists under Needs attention: merge conflicts, review and check signals, and agents that failed or went quiet. */
export const homeAttention = <T extends Pick<AttentionItem, 'type' | 'message'>>(items: T[]) => items.filter((item) => !isSousQuestion(item));

export type SignalGroup = 'blocked' | 'answer' | 'quiet';

export interface Signal { rank: number; group: SignalGroup; label: string }

export const QUESTIONS_RANK = 4;

// Lower rank is worse. A pull request signal and its agent twin read the same.
const SIGNALS: Record<string, Signal> = {
  CONFLICT: { rank: 1, group: 'blocked', label: 'CONFLICT' },
  AGENT_CHECKS_FAILING: { rank: 2, group: 'blocked', label: 'CI FAILING' },
  PR_CHECKS_FAILING: { rank: 2, group: 'blocked', label: 'CI FAILING' },
  AGENT_AC_FAILED: { rank: 3, group: 'blocked', label: 'AC FAILED' },
  AGENT_CHANGES_REQUESTED: { rank: 5, group: 'answer', label: 'CHANGES REQ' },
  PR_CHANGES_REQUESTED: { rank: 5, group: 'answer', label: 'CHANGES REQ' },
  AGENT_WAITING: { rank: 6, group: 'answer', label: 'WAITING' },
  AGENT_STALLED: { rank: 7, group: 'quiet', label: 'STALLED' },
};

export const signalOf = (type: string): Signal => SIGNALS[type] ?? { rank: 8, group: 'quiet', label: type.replace(/_/g, ' ') };

/** A ticket's sous questions, counted for Home. */
export interface TicketQuestions { key: string; title?: string | null; count: number; blocking: boolean }

export const ticketQuestions = (runs: Array<Parameters<typeof questionsOf>[0] & { key: string; title?: string | null }>): TicketQuestions[] => runs.map((run) => {
  const questions = questionsOf(run);
  return { key: run.key, title: run.title, count: questions.length, blocking: questions.some((question) => question.blocking) };
});

/** One row of Home's Needs you: everything about one ticket, or one pull request that names no ticket. */
export interface TicketAttention<T extends AttentionItem> {
  id: string;
  ticketKey: string | null;
  items: T[];
  questions: TicketQuestions | null;
  rank: number;
  groups: SignalGroup[];
}

/** Groups the attention items and the sous questions by ticket, worst signal first. */
export function ticketAttention<T extends AttentionItem>(items: T[], questions: TicketQuestions[]): Array<TicketAttention<T>> {
  const rows = new Map<string, TicketAttention<T>>();
  const rowOf = (id: string, ticketKey: string | null) => {
    const row = rows.get(id) ?? { id, ticketKey, items: [], questions: null, rank: Infinity, groups: [] };
    rows.set(id, row);
    return row;
  };
  for (const item of homeAttention(items)) {
    const row = item.ticketKey ? rowOf(item.ticketKey, item.ticketKey) : rowOf(item.id, null);
    row.items.push(item);
  }
  for (const ticket of questions.filter((entry) => entry.count > 0)) rowOf(ticket.key, ticket.key).questions = ticket;
  for (const row of rows.values()) {
    row.items.sort((a, b) => signalOf(a.type).rank - signalOf(b.type).rank);
    const signals = row.items.map((item) => signalOf(item.type));
    if (row.questions) signals.push({ rank: QUESTIONS_RANK, group: 'answer', label: '' });
    row.rank = Math.min(...signals.map((signal) => signal.rank));
    row.groups = [...new Set(signals.map((signal) => signal.group))];
  }
  return [...rows.values()].sort((a, b) => a.rank - b.rank);
}
