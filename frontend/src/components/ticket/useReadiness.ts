import { useQuery } from '@apollo/client';
import { GET_TICKET_READINESS } from '../../graphql/queries';
import { readinessRefs, ticketReadiness, type ReadinessInput, type TicketReadiness } from '../../lib/ticketDetail';

export interface SummaryFacts {
  key: string; made: string; checked: string; notHere: string; waitsOn: string[]; before: string; after: string; line: string;
  testData: string | null; ui: boolean; acId: string[]; titleId: string | null; writtenAt: string; current: boolean; acChangedAt?: string | null;
}
export interface ReadinessFacts {
  tickets: Array<{ key: string; sprint: string | null; tcApproved: boolean; decisions: Array<{ refKey: string; action: string }>; summary: SummaryFacts | null }>;
  statuses: Array<{ key: string; status: string }>;
}

type ReadinessTicket = Omit<ReadinessInput, 'summary' | 'decisions' | 'tcApproved' | 'statuses'>;

/** The readiness of every ticket from one query: the board's TODO cards, or the one ticket of the detail page. */
export function useReadiness(tickets: ReadinessTicket[], enabled = true): { readiness: Map<string, TicketReadiness>; facts: ReadinessFacts | null } {
  const keys = tickets.map((ticket) => ticket.key);
  const { data } = useQuery<{ ticketReadiness: ReadinessFacts }>(GET_TICKET_READINESS, {
    variables: { keys, refs: readinessRefs(tickets) },
    skip: !enabled || keys.length === 0,
    fetchPolicy: 'cache-and-network',
  });
  const facts = data?.ticketReadiness ?? null;
  const statuses = Object.fromEntries((facts?.statuses ?? []).map((item) => [item.key, item.status]));
  const byKey = new Map((facts?.tickets ?? []).map((item) => [item.key, item]));
  const readiness = new Map(facts ? tickets.map((ticket) => {
    const fact = byKey.get(ticket.key);
    return [ticket.key, ticketReadiness({ ...ticket, summary: fact?.summary ?? null, decisions: fact?.decisions ?? [], tcApproved: fact?.tcApproved ?? false, statuses })];
  }) : []);
  return { readiness, facts };
}

