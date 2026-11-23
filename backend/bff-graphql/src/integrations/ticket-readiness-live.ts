import { JiraAPI } from '../datasources/JiraAPI';
import { acLineRefs, splitAc } from './ac-scope';
import { ticketSummaryService } from './sprint-draft-live';
import { lintJiraTicket } from './ticket-lint';
import { readinessLine, ticketReadiness } from './ticket-readiness';

const jira = new JiraAPI();

/** The Readiness line of a ticket for the cron prompt; null when it misses nothing or cannot be read, so the prompt stays as before. */
export async function ticketReadinessLine(key: string): Promise<string | null> {
  const ticket = await jira.getTicket(key);
  if (!ticket) return null;
  const refs = [...new Set(splitAc(ticket.acceptanceCriteria).flatMap((line) => acLineRefs(line, key)))];
  const facts = await ticketSummaryService.readiness([key], refs);
  const fact = facts.tickets.find((item) => item.key === key);
  const blockedBy = (ticket.links as Array<{ key: string; relation: string }>).filter((link) => link.relation === 'blockedBy').map((link) => link.key);
  return readinessLine(ticketReadiness({
    key, title: ticket.title, acceptanceCriteria: ticket.acceptanceCriteria, blockedBy, openToConfirm: ticket.openToConfirm, figmaUrl: ticket.figmaUrl,
    summary: fact?.summary ?? null, decisions: fact?.decisions ?? [], tcApproved: fact?.tcApproved ?? false,
    statuses: Object.fromEntries(facts.statuses.map((item) => [item.key, item.status])),
    lint: lintJiraTicket(ticket, (fact?.decisions ?? []).map((item) => item.refKey)), prediction: fact?.prediction ?? null,
  }));
}
