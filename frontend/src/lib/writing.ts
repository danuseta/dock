// The writing standard (W1 to W8) as DOCK's backend checks it: findings per field, the marks on cards, the flag reason
// and the Humanize prompt. A block finding keeps a ticket out of Jira unless it is let in with a flag.

export interface LintFinding { rule: string; field: string; line: number | null; level: 'block' | 'warn'; text: string; fix: string }
export interface TicketLint { ok: boolean; findings: LintFinding[] }
export type LintMark = 'block' | 'warn';

export const WRITING_FLAG_LABEL = 'WRITING-FLAG';
export const FLAG_REASON_MIN = 5;
export const FLAG_REASON_MAX = 300;

export const flagReasonValid = (reason: string) => reason.trim().length >= FLAG_REASON_MIN && reason.trim().length <= FLAG_REASON_MAX;

/** The findings of one field, in line order. */
export const findingsOf = (lint: TicketLint | null | undefined, field: string): LintFinding[] => (lint?.findings ?? []).filter((item) => item.field === field);

/** The findings that block, which a flag has to answer for. */
export const blocksOf = (lint: TicketLint | null | undefined): LintFinding[] => (lint?.findings ?? []).filter((item) => item.level === 'block');

/** block when any finding blocks, warn when only notes are left, null when the ticket is clean. */
export function lintMark(lint: TicketLint | null | undefined): LintMark | null {
  if (!lint?.findings.length) return null;
  return lint.findings.some((item) => item.level === 'block') ? 'block' : 'warn';
}

/** One line per finding for a tooltip. */
export const lintTip = (lint: TicketLint | null | undefined): string => (lint?.findings ?? []).map((item) => `${item.rule} ${item.text}`).join('\n');

/** The Planning chat prefill that asks the agent to rewrite a ticket for a human reader; it never sends. */
export const humanizePrompt = (key: string, sprint: string) => `Humanize ${key} for sprint "${sprint}": rewrite its fields for a human reader by the writing standard without changing what the AC asks, and save a revision for me to review.`;

/** A ticket with a finding, for the bottom bar and the Board filter. */
export interface LintedTicket { key: string; lint?: TicketLint | null }

/** The tickets below the standard: a block finding. */
export const belowStandard = <T extends LintedTicket>(tickets: T[]): T[] => tickets.filter((ticket) => lintMark(ticket.lint) === 'block');
