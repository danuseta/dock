export const REVIEW_STATUS = 'PR Review';

// Statuses before review. A ticket already in review or further on is never moved back.
const BEFORE_REVIEW = new Set(['to do', 'in progress']);

/** After a broadcast: each ticket still before review goes to PR Review. Returns the keys Jira would not move. */
export async function moveToReview(
  tickets: Array<{ key: string; status?: string | null }>,
  move: (key: string, status: string) => Promise<boolean>,
): Promise<string[]> {
  const due = tickets.filter((ticket) => BEFORE_REVIEW.has(String(ticket.status ?? '').trim().toLowerCase()));
  const moved = await Promise.all(due.map((ticket) => move(ticket.key, REVIEW_STATUS)));
  return due.filter((_, index) => !moved[index]).map((ticket) => ticket.key);
}
