/** Start sprint work: the cron holds a new sprint until the owner starts it, and shows what it would take first. */

export interface SprintStartTicket { key: string; title: string; order: number | null; orderSource: string | null; waitsOn: string | null }
export interface SprintStartPreview { slots: number; parallel: number; parked: string[]; first: SprintStartTicket[]; blocked: SprintStartTicket[]; next: SprintStartTicket[] }
export interface SprintStart { sprint: string; holdOn: boolean; held: boolean; startedAt: string | null; preview: SprintStartPreview }

export const HOLD_TEXT = 'Cron holds this sprint until you start it';

/** "#14" for a ticket with a work order, nothing for one the ticket number orders. */
export const orderText = (ticket: Pick<SprintStartTicket, 'order'>) => (ticket.order == null ? '' : `#${ticket.order}`);

/** Where the order of the tickets shown comes from. */
export function orderSourceText(preview: SprintStartPreview): string {
  const sources = new Set([...preview.first, ...preview.blocked, ...preview.next].map((ticket) => ticket.orderSource));
  if (sources.has('owner')) return sources.has('jira') ? 'order: yours, then Jira #N' : 'order: yours';
  return sources.has('jira') ? 'order from Jira #N' : 'order: ticket number';
}

/** "3 slots · order from Jira #N" under the Start button. */
export const previewSummary = (preview: SprintStartPreview) => `${preview.slots} ${preview.slots === 1 ? 'slot' : 'slots'} · ${orderSourceText(preview)}`;

/** What a blocked ticket waits on. */
export const waitsText = (ticket: Pick<SprintStartTicket, 'waitsOn'>) => (ticket.waitsOn === 'pending' ? 'waits for your call on a proposed dependency' : ticket.waitsOn ? `waits on ${ticket.waitsOn}` : 'blocked');
