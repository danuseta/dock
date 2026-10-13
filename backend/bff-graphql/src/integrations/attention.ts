import type { PullRequestSignal } from './pr-signals';

export interface AttentionItem { id: string; type: string; message: string; ticketKey?: string | null }

export type PullRequestProblem = 'CONFLICT' | 'PR_CHANGES_REQUESTED' | 'PR_CHECKS_FAILING';

/** What is wrong with one of the owner's open pull requests. */
export function pullRequestProblems(
  status: { mergeable?: boolean | null; mergeable_state?: string },
  signal: PullRequestSignal,
): PullRequestProblem[] {
  const problems: PullRequestProblem[] = [];
  if (status.mergeable === false || status.mergeable_state === 'dirty') problems.push('CONFLICT');
  if (signal.reviewDecision === 'changes_requested') problems.push('PR_CHANGES_REQUESTED');
  if (signal.checks === 'failing') problems.push('PR_CHECKS_FAILING');
  return problems;
}

// Work on these tickets is over for the owner, so nothing about them needs attention any more.
const SETTLED_STATUSES = new Set(['uat check', 'readyforproduction', 'done / merged']);

export const isSettledStatus = (status: string | null | undefined) => SETTLED_STATUSES.has(String(status || '').trim().toLowerCase());

const AGENT_TWIN: Record<string, string> = { PR_CHANGES_REQUESTED: 'AGENT_CHANGES_REQUESTED', PR_CHECKS_FAILING: 'AGENT_CHECKS_FAILING' };

/** Agent items first, then the pull request items an agent run of the same ticket does not already report. */
export function mergeAttention<A extends AttentionItem, P extends AttentionItem>(agentItems: A[], pullRequestItems: P[]): Array<A | P> {
  const reported = new Set(agentItems.map((item) => `${item.type} ${item.ticketKey}`));
  return [...agentItems, ...pullRequestItems.filter((item) => !reported.has(`${AGENT_TWIN[item.type]} ${item.ticketKey}`))];
}

/** Drops the items of tickets whose Jira status says the work is settled; a ticket without a known status stays. */
export function withoutSettledTickets<T extends AttentionItem>(items: T[], statusOf: Map<string, string>): T[] {
  return items.filter((item) => !item.ticketKey || !isSettledStatus(statusOf.get(item.ticketKey)));
}
