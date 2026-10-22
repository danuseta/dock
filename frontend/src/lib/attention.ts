export interface AttentionItem { id: string; type: string; message: string; ticketKey?: string | null }

/** A sous question waiting on the owner; it is answered on Decisions, not listed with the pull request problems. */
export const isSousQuestion = (item: Pick<AttentionItem, 'type' | 'message'>) => item.type === 'AGENT_ISSUE' || (item.type === 'AGENT_WAITING' && /^Waiting on you: I-\d+:/.test(item.message));

/** What Home lists under Needs attention: merge conflicts, review and check signals, and agents that failed or went quiet. */
export const homeAttention = <T extends Pick<AttentionItem, 'type' | 'message'>>(items: T[]) => items.filter((item) => !isSousQuestion(item));
