import { acLineRefs, splitAc } from './ac-scope';
import type { TicketLint } from './ticket-lint';

// "Ready to start" as the cron prompt needs it. The ticket detail and the board compute the same items in
// frontend/src/lib/ticketDetail.ts; the ids and the texts of the items are the same on both sides. Information only:
// a ticket that misses items is still worked, and the agent is told what it has to work around.

export type ReadinessId = 'refs' | 'open' | 'summary' | 'alone' | 'data' | 'tc' | 'design' | 'writing' | 'qa';
export interface ReadinessItem { id: ReadinessId; ok: boolean; text: string }
export interface TicketReadiness { items: ReadinessItem[]; done: number; total: number; missing: ReadinessItem[] }
export interface ReadinessInput {
  key: string;
  title: string;
  acceptanceCriteria?: string | null;
  blockedBy?: string[] | null;
  openToConfirm?: string | null;
  figmaUrl?: string | null;
  summary?: { current: boolean; testData: string | null; ui: boolean } | null;
  decisions?: Array<{ refKey: string; action: string }> | null;
  tcApproved?: boolean | null;
  statuses?: Record<string, string> | null;
  lint?: TicketLint | null;
  /** The QA bot's prediction of the ticket; null before it ran, which leaves the qa item out. */
  prediction?: string | null;
}

const IN_UAT = ['uatcheck', 'uatbuggimprovement', 'uatbugimprovement', 'readyforproduction', 'rfp', 'done', 'donemerged', 'merged'];
const MOVED = ['reference', 'move'];
const inUat = (status?: string | null) => IN_UAT.includes(String(status ?? '').toLowerCase().replace(/[^a-z]/g, ''));

export function ticketReadiness(input: ReadinessInput): TicketReadiness {
  const refs = [...new Set(splitAc(input.acceptanceCriteria).flatMap((line) => acLineRefs(line, input.key)))];
  const linked = new Set((input.blockedBy ?? []).map((key) => key.toUpperCase()));
  const decided = new Map((input.decisions ?? []).map((item) => [item.refKey.toUpperCase(), item.action]));
  const undecided = refs.filter((ref) => !linked.has(ref) && !decided.has(ref));
  const waits = refs.filter((ref) => !MOVED.includes(decided.get(ref) ?? ''));
  const statuses = input.statuses ?? {};
  const notInUat = waits.filter((ref) => !inUat(statuses[ref]));
  const summary = input.summary ?? null;
  const ui = /\[FE\]/i.test(input.title) || !!summary?.ui;
  const blocks = (input.lint?.findings ?? []).filter((item) => item.level === 'block').length;
  const items: ReadinessItem[] = [
    undecided.length
      ? { id: 'refs', ok: false, text: `Undecided references to other tickets: ${undecided.length}` }
      : { id: 'refs', ok: true, text: refs.length ? 'References to other tickets are decided' : 'AC names no other ticket' },
    (input.openToConfirm ?? '').trim()
      ? { id: 'open', ok: false, text: 'Open to confirm is not empty' }
      : { id: 'open', ok: true, text: 'Open to confirm is empty' },
    !summary
      ? { id: 'summary', ok: false, text: 'No summary yet' }
      : summary.current
        ? { id: 'summary', ok: true, text: 'Summary exists' }
        : { id: 'summary', ok: false, text: 'Summary is stale: AC changed after it was written' },
    notInUat.length
      ? { id: 'alone', ok: false, text: `Tickets the AC waits on, not in UAT yet: ${notInUat.length}` }
      : { id: 'alone', ok: true, text: waits.length ? 'Tickets it waits on are in UAT' : 'Testable without other tickets' },
    !summary
      ? { id: 'data', ok: false, text: 'Test data: no summary yet' }
      : summary.testData
        ? { id: 'data', ok: true, text: 'Test data named' }
        : { id: 'data', ok: false, text: 'Test data not named' },
    input.tcApproved
      ? { id: 'tc', ok: true, text: 'Test cases approved by QA' }
      : { id: 'tc', ok: false, text: 'Test cases not approved by QA' },
    !summary && !ui
      ? { id: 'design', ok: false, text: 'Design: no summary yet' }
      : !ui
        ? { id: 'design', ok: true, text: 'No UI, no design needed' }
        : input.figmaUrl
          ? { id: 'design', ok: true, text: 'Design link in Figma Link' }
          : { id: 'design', ok: false, text: 'UI ticket without a design link' },
    blocks
      ? { id: 'writing', ok: false, text: `Below the writing standard: ${blocks} ${blocks === 1 ? 'finding' : 'findings'} to fix` }
      : { id: 'writing', ok: true, text: 'Meets the writing standard' },
    ...(input.prediction
      ? [input.prediction === 'ESCALATED'
        ? { id: 'qa' as const, ok: false, text: 'QA predicts ESCALATED: the AC may not be testable' }
        : { id: 'qa' as const, ok: true, text: 'QA prediction is not ESCALATED' }]
      : []),
  ];
  const missing = items.filter((item) => !item.ok);
  return { items, done: items.length - missing.length, total: items.length, missing };
}

/** The line the cron prompt carries: `Readiness 7/9: data (Test data not named); tc (Test cases not approved by QA)`; null when nothing is missing. */
export const readinessLine = (readiness: TicketReadiness): string | null => (
  readiness.missing.length ? `Readiness ${readiness.done}/${readiness.total}: ${readiness.missing.map((item) => `${item.id} (${item.text})`).join('; ')}` : null
);
