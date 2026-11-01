/** The title of a session on a ticket: `Task-QRD-1230` builds it, `Review-QRD-1230` reviews its pull request. */
export const TICKET_TITLE = /^(Task|Review)-[A-Z][A-Z0-9]+-\d+$/;
export const ticketSessionTitle = (kind: 'Task' | 'Review', key: string) => `${kind}-${key}`;
/** `base` is a ticket title: letters, digits and dashes only, nothing to escape. */
const numbered = (base: string) => new RegExp(`^${base}(?: \\((\\d+)\\))?$`);

/** The base title, or the base with the next number after the ones already taken: ` (2)` for the second session. */
export function nextSessionTitle(base: string, taken: string[]): string {
  const pattern = numbered(base);
  const used = taken.flatMap((title) => { const match = pattern.exec(title); return match ? [match[1] ? Number(match[1]) : 1] : []; });
  return used.length === 0 ? base : `${base} (${Math.max(...used) + 1})`;
}

/** Whether a title is one of the `Task-` titles of a ticket, numbered or not. */
export const isTaskTitle = (title: string, key: string) => numbered(ticketSessionTitle('Task', key)).test(title);

const TICKET_IN_TEXT = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const REVIEW_WORDS = /\breview\w*/i;
const BUILD_WORDS = /\b(kerjakan|kerjain|build|implement\w*|lanjutkan|bikin)\b/i;

/**
 * A chat opened by hand on one ticket gets the cron's title for it: "review QRD-1491" is `Review-QRD-1491`, "kerjakan
 * QRD-1491" is `Task-QRD-1491`. Null when the first message names no ticket or no review or build.
 */
export function ticketTitleFromText(text: string): { kind: 'Task' | 'Review'; key: string } | null {
  const key = TICKET_IN_TEXT.exec(text)?.[1];
  if (!key || key.startsWith('CARD-')) return null;
  if (REVIEW_WORDS.test(text)) return { kind: 'Review', key };
  if (BUILD_WORDS.test(text)) return { kind: 'Task', key };
  return null;
}
