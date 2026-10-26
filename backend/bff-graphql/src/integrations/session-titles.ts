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
