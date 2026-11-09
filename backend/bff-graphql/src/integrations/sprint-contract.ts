// The Confluence page "Sprint contract <sprint>" Publish writes next to the Jira changes: release order by wave, the AC
// rules everyone works by, the planner's decisions with who and when, and what a developer may change without the PO.
// It lives under the parent page set in Settings (planningConfluenceParent) and is rewritten on every publish.
import { escapeXml, type ConfluenceClient } from './confluence';
import type { DraftView } from './sprint-draft';

export const CONTRACT_PARENT_KEY = 'planningConfluenceParent';
export type ContractClient = Pick<ConfluenceClient, 'page' | 'findPage' | 'createPage' | 'updatePage'>;
export interface ContractResult { status: 'updated' | 'skipped' | 'failed'; detail: string }

const day = (value: number) => `D${Math.max(1, Math.ceil(value))}`;
const cell = (value: string | number | null | undefined) => `<td>${escapeXml(value === null || value === undefined || value === '' ? '-' : String(value))}</td>`;
const row = (cells: Array<string | number | null | undefined>) => `<tr>${cells.map(cell).join('')}</tr>`;
const table = (headings: string[], rows: string[]) => `<table><tbody><tr>${headings.map((heading) => `<th>${escapeXml(heading)}</th>`).join('')}</tr>${rows.join('')}</tbody></table>`;
const list = (items: string[]) => `<ul>${items.map((item) => `<li>${escapeXml(item)}</li>`).join('')}</ul>`;
const when = (at: string) => at.slice(0, 16).replace('T', ' ');

export const contractTitle = (sprint: string) => `Sprint contract ${sprint}`;

export const AC_RULES = [
  'An AC line is tested on the ticket that carries it, in UAT, after every ticket it names has landed.',
  'An AC line that needs a ticket landing later is moved to that ticket, kept to wait for it, or dropped before publish.',
  'A ticket names the frames of the storyboard it builds (F<n>.<m>) in its AC or description; a changed frame puts its AC up for a check.',
  'The QA bot reads the latest QONFLO-TC v1 comment of a ticket as its test cases.',
];

export const CHANGES_WITHOUT_PO = [
  'Move an AC line to the ticket that builds what it needs: directly when both tickets are yours, through the ac-move-pending label and a comment on both tickets when the other is a teammate\'s.',
  'Mark an AC line not tested here when the ticket it needs has not landed, with the reason on the ticket.',
  'Keep an AC line waiting for the ticket it needs.',
  'Anything else that changes what a ticket delivers is flagged Needs PO.',
];

/** The page body in Confluence storage format. */
export function contractStorage(view: DraftView, publishedBy: string | null, now: Date): string {
  const waves = [...new Set(view.tickets.map((ticket) => ticket.wave))].sort((a, b) => a - b);
  const order = waves.map((wave) => {
    const tickets = view.tickets.filter((ticket) => ticket.wave === wave);
    const closes = Math.max(0, ...tickets.map((ticket) => ticket.end));
    return `<h3>Wave ${wave} · closes ${day(closes)}</h3>${table(['Ticket', 'Summary', 'Developer', 'SP', 'Days', 'Sprint'], tickets.map((ticket) => row([
      ticket.key, ticket.summary, ticket.dev, ticket.sp, `${day(ticket.start + 0.001)} to ${day(ticket.end)}`, ticket.inSprint ? 'in' : 'backlog',
    ])))}`;
  }).join('');
  const decisions = [
    ...view.findings.filter((finding) => finding.decision).map((finding) => row([
      `${finding.key} AC ${finding.line}`, `${finding.decision!.action}${finding.decision!.action === 'move' ? ` to ${finding.refKey}` : ''}: ${finding.text}`,
      finding.decision!.note, finding.decision!.by, when(finding.decision!.at),
    ])),
    ...view.tickets.filter((ticket) => ticket.qaDecision).map((ticket) => row([
      `${ticket.key} QA ${ticket.prediction?.prediction ?? ''}`.trim(), ticket.qaDecision!.action === 'fix' ? 'fixed' : 'risk accepted',
      ticket.qaDecision!.note, ticket.qaDecision!.by, when(ticket.qaDecision!.at),
    ])),
  ];
  return [
    `<p>Published from DOCK Planning${publishedBy ? ` by ${escapeXml(publishedBy)}` : ''} on ${escapeXml(when(now.toISOString()))} UTC. ${view.sprintDays} working days, 1 SP = ${1 / view.spPerDay} day.</p>`,
    '<h2>Release order</h2>',
    order || '<p>No open tickets.</p>',
    '<h2>AC rules</h2>',
    list(AC_RULES),
    '<h2>Decisions</h2>',
    decisions.length ? table(['Item', 'Decision', 'Note', 'By', 'When (UTC)'], decisions) : '<p>No decision was needed.</p>',
    '<h2>Changes without the PO</h2>',
    list(CHANGES_WITHOUT_PO),
  ].join('');
}

/** Creates the page under the parent, or rewrites it when the parent's space already has it. */
export async function writeContract(client: ContractClient | null, parentId: string | null, view: DraftView, publishedBy: string | null, now: Date): Promise<ContractResult> {
  if (!parentId) return { status: 'skipped', detail: `No Confluence parent page is set (Settings ${CONTRACT_PARENT_KEY}); the contract page was not written` };
  if (!client) return { status: 'skipped', detail: 'Jira credentials are not configured; the contract page was not written' };
  try {
    const parent = await client.page(parentId);
    if (!parent) return { status: 'failed', detail: `Confluence page ${parentId} (${CONTRACT_PARENT_KEY}) was not found` };
    if (!parent.spaceKey) return { status: 'failed', detail: `Confluence page ${parentId} has no space` };
    const title = contractTitle(view.sprint);
    const storage = contractStorage(view, publishedBy, now);
    const existing = await client.findPage(parent.spaceKey, title);
    const page = existing ? await client.updatePage(existing, storage) : await client.createPage(parent.spaceKey, parent.id, title, storage);
    return { status: 'updated', detail: `${existing ? 'Updated' : 'Created'} "${title}" (page ${page.id}, v${page.version}) in ${parent.spaceKey}` };
  } catch (error: any) {
    const status = error?.response?.status;
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', detail: status ? `Confluence responded ${status}: ${message}` : message };
  }
}
