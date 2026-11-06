/** Jira labels ending in Pass name who approved the ticket, such as alvinPass; they show as written. */
export const getPassLabels = (labels: string[] = []) => [...new Set(labels
  .map((label) => label.trim())
  .filter((label) => label.length > 4 && /pass$/i.test(label)))];

export const passCount = (labels: string[] = [], slots = 2) => ({ n: Math.min(getPassLabels(labels).length, slots), of: slots });

export const openConflict = (prs: Array<{ status: string; mergeable?: boolean | null }> = []) => prs.some((pr) => ['open', 'draft'].includes(pr.status.toLowerCase()) && pr.mergeable === false);

export const slotsForTicket = (threads: Array<{ kind: string; slots: number; tickets: Array<{ key: string }> }> = [], key: string) => threads.find((thread) => thread.kind === 'pr' && thread.tickets.some((item) => item.key === key))?.slots ?? 2;
