// Which AC lines of a sprint draft need another ticket, and whether that ticket lands before this one. An AC line that
// needs a ticket landing later cannot be tested when this ticket reaches QA: that is the line Planning makes the
// planner decide on before publish.

export type AcFindingKind = 'after-it' | 'lands-first' | 'outside-plan';

export interface AcTicket {
  key: string;
  ac: string[];
}

export interface AcFinding {
  id: string;
  key: string;
  /** 1-based number of the line in the ticket's AC. */
  line: number;
  text: string;
  refKey: string;
  kind: AcFindingKind;
  /** The day the referenced ticket ends in the plan; null when it is done or outside the plan. */
  refEnd: number | null;
  ownEnd: number | null;
}

/** Statuses past merge, compared letters only: Jira names them "Done / MERGED", "ReadyForProduction", "UAT CHECK". */
export const DONE_STATUSES = ['uatcheck', 'uatmerged', 'readyforproduction', 'rfp', 'done', 'donemerged', 'merged'];
const KEY_REF = /\bQRD-\d+\b/gi;
const BULLET = /^(?:[-*•]\s+|\d+[.)]\s+|\[[ xX]?\]\s+)/;

export const isDoneStatus = (status: string | null | undefined) => DONE_STATUSES.includes(String(status ?? '').toLowerCase().replace(/[^a-z]/g, ''));

/** One AC line as compared everywhere: bullets and numbering dropped, spaces collapsed. */
export function normalizeAcLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim().replace(BULLET, '').trim();
}

/** The AC field's text split into lines, empty lines dropped. */
export function splitAc(text: string | null | undefined): string[] {
  return String(text ?? '').split(/\r?\n/).map(normalizeAcLine).filter(Boolean);
}

export const findingId = (key: string, refKey: string, text: string) => `ac|${key}|${refKey}|${normalizeAcLine(text)}`;

/**
 * Every reference from an AC line to another ticket. A referenced ticket that is done lands first; one in the plan lands
 * first when it ends no later than this ticket; one ending later is after-it; anything else is outside the plan.
 */
export function acFindings(
  tickets: AcTicket[],
  ends: Map<string, number>,
  statusOf: (key: string) => string | null | undefined,
): AcFinding[] {
  const findings: AcFinding[] = [];
  for (const ticket of tickets) {
    const ownEnd = ends.get(ticket.key) ?? null;
    ticket.ac.forEach((text, index) => {
      const refs = [...new Set((text.match(KEY_REF) || []).map((ref) => ref.toUpperCase()))].filter((ref) => ref !== ticket.key.toUpperCase());
      for (const refKey of refs) {
        const refEnd = ends.get(refKey);
        let kind: AcFindingKind;
        if (isDoneStatus(statusOf(refKey))) kind = 'lands-first';
        else if (refEnd === undefined) kind = 'outside-plan';
        else kind = ownEnd !== null && refEnd > ownEnd ? 'after-it' : 'lands-first';
        findings.push({
          id: findingId(ticket.key, refKey, text), key: ticket.key, line: index + 1, text, refKey, kind,
          refEnd: kind === 'outside-plan' || isDoneStatus(statusOf(refKey)) ? null : refEnd ?? null, ownEnd,
        });
      }
    });
  }
  return findings;
}
