import type { AgentRun } from '../agents/runs';

/** The stops the ticket header walks; evidence and commit count as Verify, as on the flow graph. */
export const TICKET_STEPS = [
  { id: 'gate', name: 'Gate' },
  { id: 'plan', name: 'Plan' },
  { id: 'code', name: 'Code' },
  { id: 'test', name: 'Test' },
  { id: 'verify', name: 'Verify' },
  { id: 'pr', name: 'PR' },
  { id: 'done', name: 'Done' },
] as const;

const STEP_OF: Record<string, string> = { evidence: 'verify', commit: 'verify' };

/** Where the run is on the steps, or -1 when the stage is not one of them (blocked, unknown). */
export const stepIndex = (stage?: string | null): number => (
  stage ? TICKET_STEPS.findIndex((step) => step.id === (STEP_OF[stage] ?? stage)) : -1
);

export type RunState = 'none' | 'waiting' | 'stalled' | 'running' | 'pr' | 'finished';

type RunFacts = Pick<AgentRun, 'waiting' | 'stalled' | 'finished' | 'stage'>;

/** A run at stage pr is not working: its pull request waits for a reviewer. */
export const runState = (run?: RunFacts | null): RunState => {
  if (!run) return 'none';
  if (run.finished) return 'finished';
  if (run.waiting) return 'waiting';
  if (run.stage === 'pr') return 'pr';
  return run.stalled ? 'stalled' : 'running';
};

export const RUN_STATE_LABEL: Record<RunState, string> = {
  none: 'No agent run',
  waiting: 'Waiting on you',
  stalled: 'Stalled',
  running: 'Agent running',
  pr: 'PR open · waiting for review',
  finished: 'Run finished',
};

export type NeedKind = 'question' | 'sous' | 'ac' | 'review' | 'conflict';

export interface NeedItem {
  id: string;
  kind: NeedKind;
  text: string;
  /** For a question: the fixed answers the agent offered, shown as buttons. */
  choices?: string[];
}

const CHOICES = /\s*\[([^\][|]+(?:\|[^\][|]+)+)\]\s*$/;

/** "Keep the tag filter? [Keep|Drop]" reads as the question plus its answers; without brackets there are none. */
export const splitChoices = (waiting: string): { question: string; choices: string[] } => {
  const match = CHOICES.exec(waiting);
  if (!match) return { question: waiting, choices: [] };
  return { question: waiting.slice(0, match.index).trim(), choices: match[1].split('|').map((choice) => choice.trim()).filter(Boolean) };
};

interface NeedFacts {
  run?: Pick<AgentRun, 'waiting' | 'finished' | 'stage' | 'ac' | 'reviewSignal' | 'engine'> | null;
  pullRequests?: Array<{ id?: string | null; repo?: string | null; number?: number | null; pullNumber?: number | null; status?: string | null }> | null;
}

const REVIEW_TEXT: Partial<Record<NonNullable<AgentRun['reviewSignal']>, string>> = {
  changes_requested: 'A reviewer asked for changes on the pull request',
  checks_failing: 'Checks are failing on the pull request',
};

/** What waits on the owner for this ticket, most urgent first. Empty when nothing does. */
export function needsYou({ run, pullRequests }: NeedFacts): NeedItem[] {
  const items: NeedItem[] = [];
  if (run?.waiting && !run.finished) {
    const { question, choices } = splitChoices(run.waiting);
    // A sous issue is answered on Agents, so it shows here without answers of its own.
    if (run.engine === 'sous' && /^I-\d+:/.test(question)) items.push({ id: 'question', kind: 'sous', text: question });
    else items.push({ id: 'question', kind: 'question', text: question, choices });
  }
  for (const item of run?.ac ?? []) {
    if (item.state === 'FAIL') items.push({ id: `ac-${item.n}`, kind: 'ac', text: item.text || `AC ${item.n}` });
  }
  const review = run?.reviewSignal ? REVIEW_TEXT[run.reviewSignal] : undefined;
  if (review) items.push({ id: 'review', kind: 'review', text: review });
  for (const pr of pullRequests ?? []) {
    if (pr.status?.toUpperCase() === 'CONFLICT') items.push({ id: `conflict-${pr.id ?? pr.repo}`, kind: 'conflict', text: `${pr.repo}#${pr.pullNumber ?? pr.number} has a merge conflict` });
  }
  return items;
}

/** A description longer than this many lines starts folded. */
export const DESCRIPTION_LINES = 8;

export const isLongDescription = (text?: string | null, lines = DESCRIPTION_LINES): boolean => (
  Boolean(text) && ((text as string).split('\n').length > lines || (text as string).length > lines * 110)
);

/** What the BFF sends when the Jira description is empty. */
export const NO_DESCRIPTION = 'No detailed description provided in this Jira issue.';

/** The Jira Acceptance Criteria field as one criterion per line, without the list or checkbox marker. */
export const jiraAcLines = (text?: string | null): string[] => (text || '')
  .split('\n')
  .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, '').trim())
  .filter(Boolean);

export interface DependencyChoice { key: string; title: string; sprintState?: string | null }

const keyNumber = (key: string) => Number(/-(\d+)$/.exec(key)?.[1] ?? 0);

/** The tickets a ticket can depend on: each once, itself left out, the active sprint first and the newest key first within each part. */
export function dependencyChoices(tickets: DependencyChoice[], ticketKey: string): DependencyChoice[] {
  const unique = [...new Map(tickets.filter((item) => item.key !== ticketKey).map((item) => [item.key, item])).values()];
  const active = (item: DependencyChoice) => (item.sprintState === 'ACTIVE' ? 0 : 1);
  return unique.sort((first, second) => active(first) - active(second) || keyNumber(second.key) - keyNumber(first.key));
}

export const matchesChoice = (choice: DependencyChoice, query: string) => {
  const needle = query.trim().toLowerCase();
  return !needle || `${choice.key} ${choice.title}`.toLowerCase().includes(needle);
};

// ---- Siap dikerjain (G2): what a ticket still misses before work starts. Only information; no status move is refused.

const KEY_REF = /\bQRD-\d+\b/gi;

/** The other tickets each AC line names, in line order; the ticket's own key is left out. */
export function acRefs(key: string, lines: string[]): Array<{ n: number; text: string; refs: string[] }> {
  const own = key.toUpperCase();
  return lines.map((text, index) => ({ n: index + 1, text, refs: [...new Set((text.match(KEY_REF) ?? []).map((ref) => ref.toUpperCase()))].filter((ref) => ref !== own) }));
}

/** Every key the AC of these tickets names, for one status read of the whole board. */
export const readinessRefs = (tickets: Array<{ key: string; acceptanceCriteria?: string | null }>): string[] => (
  [...new Set(tickets.flatMap((ticket) => acRefs(ticket.key, jiraAcLines(ticket.acceptanceCriteria)).flatMap((line) => line.refs)))].sort()
);

/** Statuses from UAT CHECK on: the screen of a ticket there can be used to test another. */
const IN_UAT = ['uatcheck', 'uatbuggimprovement', 'uatbugimprovement', 'readyforproduction', 'rfp', 'done', 'donemerged', 'merged'];
export const inUat = (status?: string | null) => IN_UAT.includes(String(status ?? '').toLowerCase().replace(/[^a-z]/g, ''));

export interface RefDecision { refKey: string; action: string }
export interface ReadinessSummary { current: boolean; testData: string | null; ui: boolean }
export interface ReadinessInput {
  key: string; title: string; url?: string | null; acceptanceCriteria?: string | null; blockedBy?: string[] | null;
  openToConfirm?: string | null; figmaUrl?: string | null;
  summary?: ReadinessSummary | null; decisions?: RefDecision[] | null; tcApproved?: boolean | null;
  statuses?: Record<string, string> | null;
}
export type ReadinessId = 'refs' | 'open' | 'summary' | 'alone' | 'data' | 'tc' | 'design';
export interface ReadinessItem { id: ReadinessId; ok: boolean; text: string; detail: string | null; fix: string | null; href: string | null }
export interface TicketReadiness { items: ReadinessItem[]; done: number; total: number; missing: ReadinessItem[] }

const keyList = (keys: string[]) => `${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ` +${keys.length - 3} lagi` : ''}`;
const MOVED = ['reference', 'move'];

/** A ticket with UI: its title says [FE], or the planning agent's summary says it changes a screen. */
export const hasUi = (title: string, summary?: Pick<ReadinessSummary, 'ui'> | null) => /\[FE\]/i.test(title) || !!summary?.ui;

/**
 * "Siap dikerjain n dari 7": every ticket the AC names is decided, Open to confirm is empty, there is a current summary,
 * no AC line needs a ticket that is not in UAT yet, the test data is named, QA approved the test cases, and a ticket with
 * UI has its Figma link. Each missing item says what is missing and where it gets fixed.
 */
export function ticketReadiness(input: ReadinessInput): TicketReadiness {
  const lines = acRefs(input.key, jiraAcLines(input.acceptanceCriteria));
  const refs = [...new Set(lines.flatMap((line) => line.refs))];
  const linked = new Set((input.blockedBy ?? []).map((key) => key.toUpperCase()));
  const decided = new Map((input.decisions ?? []).map((item) => [item.refKey.toUpperCase(), item.action]));
  const undecided = refs.filter((ref) => !linked.has(ref) && !decided.has(ref));
  const waits = refs.filter((ref) => !MOVED.includes(decided.get(ref) ?? ''));
  const statuses = input.statuses ?? {};
  const notInUat = waits.filter((ref) => !inUat(statuses[ref]));
  const summary = input.summary ?? null;
  const open = (input.openToConfirm ?? '').trim();
  const ui = hasUi(input.title, summary);
  const jira = input.url ?? null;
  const items: ReadinessItem[] = [
    undecided.length
      ? { id: 'refs', ok: false, text: `${undecided.length} rujukan tiket lain belum diputusin`, detail: `${keyList(undecided)}: pasang link Blocks kalau ditunggu, atau pindahin barisnya ke Reference`, fix: 'Planning › AC check', href: '/planning?tab=draft&panel=ac' }
      : { id: 'refs', ok: true, text: refs.length ? 'Rujukan tiket lain udah jelas' : 'AC nggak nyebut tiket lain', detail: null, fix: null, href: null },
    open
      ? { id: 'open', ok: false, text: 'Open to confirm masih ada isinya', detail: open.length > 140 ? `${open.slice(0, 140)}…` : open, fix: 'Buka di Jira', href: jira }
      : { id: 'open', ok: true, text: 'Open to confirm kosong', detail: null, fix: null, href: null },
    !summary
      ? { id: 'summary', ok: false, text: 'Belum ada ringkasan', detail: 'Ditulis agent planning waktu draft ditarik dari Jira', fix: 'Planning › Draft', href: '/planning?tab=draft' }
      : summary.current
        ? { id: 'summary', ok: true, text: 'Ringkasan ada', detail: null, fix: null, href: null }
        : { id: 'summary', ok: false, text: 'Ringkasan basi: AC berubah sesudah ringkasan ditulis', detail: 'Agent planning nulis ulang waktu draft ditarik lagi', fix: 'Planning › Draft', href: '/planning?tab=draft' },
    notInUat.length
      ? { id: 'alone', ok: false, text: `${notInUat.length} tiket yang ditunggu AC belum di UAT`, detail: notInUat.map((ref) => `${ref} (${statuses[ref] ?? 'status belum kebaca'})`).join(', '), fix: 'Lihat baris AC', href: '#acceptance-criteria' }
      : { id: 'alone', ok: true, text: waits.length ? 'Tiket yang ditunggu udah di UAT' : 'Bisa dites tanpa nunggu tiket lain', detail: null, fix: null, href: null },
    !summary
      ? { id: 'data', ok: false, text: 'Data uji: belum ada ringkasan', detail: null, fix: 'Planning › Draft', href: '/planning?tab=draft' }
      : summary.testData
        ? { id: 'data', ok: true, text: 'Data uji disebut', detail: summary.testData, fix: null, href: null }
        : { id: 'data', ok: false, text: 'Data uji belum disebut', detail: 'Tulis data uji yang dipakai di tiket', fix: 'Buka di Jira', href: jira },
    input.tcApproved
      ? { id: 'tc', ok: true, text: 'Test case disetujui QA', detail: null, fix: null, href: null }
      : { id: 'tc', ok: false, text: 'Test case belum disetujui QA', detail: null, fix: 'Planning › Test cases', href: '/planning?tab=draft&panel=tc' },
    !summary && !ui
      ? { id: 'design', ok: false, text: 'Desain: belum ada ringkasan', detail: 'Ringkasan yang bilang tiket ini ada UI atau nggak', fix: 'Planning › Draft', href: '/planning?tab=draft' }
      : !ui
        ? { id: 'design', ok: true, text: 'Tiket tanpa UI, nggak perlu desain', detail: null, fix: null, href: null }
        : input.figmaUrl
          ? { id: 'design', ok: true, text: 'Link desain ada di Figma Link', detail: null, fix: null, href: null }
          : { id: 'design', ok: false, text: 'Tiket UI tanpa link desain', detail: 'Isi field Figma Link', fix: 'Buka di Jira', href: jira },
  ];
  const missing = items.filter((item) => !item.ok);
  return { items, done: items.length - missing.length, total: items.length, missing };
}

/** The board shows the chip only on cards in the TODO column. */
export const readinessOnBoard = (columnId: string, readiness: TicketReadiness | null | undefined): TicketReadiness | null => (columnId === 'TODO' ? readiness ?? null : null);

export type LinkKind = 'reference' | 'blocks' | 'open';
export interface TicketLinkRow { key: string; kind: LinkKind; text: string | null }

/**
 * "Nyambung ke N tiket": a ticket only mentioned in Reference (or decided to move there) is reference, a Blocks link or a
 * line decided as a dependency is blocks, and an AC line naming a ticket with neither is open.
 */
export function ticketLinks(input: Pick<ReadinessInput, 'key' | 'acceptanceCriteria' | 'blockedBy' | 'decisions'> & { reference?: string | null }): TicketLinkRow[] {
  const own = input.key.toUpperCase();
  const lines = acRefs(input.key, jiraAcLines(input.acceptanceCriteria));
  const decided = new Map((input.decisions ?? []).map((item) => [item.refKey.toUpperCase(), item.action]));
  const linked = new Set((input.blockedBy ?? []).map((key) => key.toUpperCase()));
  const links = new Map<string, TicketLinkRow>();
  const textOf = (ref: string) => lines.find((line) => line.refs.includes(ref))?.text ?? null;
  for (const ref of linked) links.set(ref, { key: ref, kind: 'blocks', text: textOf(ref) });
  for (const ref of [...new Set(lines.flatMap((line) => line.refs))]) {
    if (links.has(ref)) continue;
    const action = decided.get(ref);
    links.set(ref, { key: ref, kind: action === 'dependency' ? 'blocks' : action && MOVED.includes(action) ? 'reference' : 'open', text: textOf(ref) });
  }
  for (const line of jiraAcLines(input.reference)) {
    for (const ref of new Set((line.match(KEY_REF) ?? []).map((item) => item.toUpperCase()))) {
      if (ref !== own && !links.has(ref)) links.set(ref, { key: ref, kind: 'reference', text: line });
    }
  }
  return [...links.values()];
}
