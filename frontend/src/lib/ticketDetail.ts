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

export type RunState = 'none' | 'waiting' | 'stalled' | 'running' | 'finished';

type RunFacts = Pick<AgentRun, 'waiting' | 'stalled' | 'finished'>;

export const runState = (run?: RunFacts | null): RunState => {
  if (!run) return 'none';
  if (run.finished) return 'finished';
  if (run.waiting) return 'waiting';
  return run.stalled ? 'stalled' : 'running';
};

export const RUN_STATE_LABEL: Record<RunState, string> = {
  none: 'No agent run',
  waiting: 'Waiting on you',
  stalled: 'Stalled',
  running: 'Agent running',
  finished: 'Run finished',
};

export type NeedKind = 'question' | 'ac' | 'review' | 'conflict' | 'demo';

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
  run?: Pick<AgentRun, 'waiting' | 'finished' | 'stage' | 'ac' | 'reviewSignal'> | null;
  pullRequests?: Array<{ id?: string | null; repo?: string | null; number?: number | null; pullNumber?: number | null; status?: string | null }> | null;
  demoUrl?: string | null;
}

const REVIEW_TEXT: Partial<Record<NonNullable<AgentRun['reviewSignal']>, string>> = {
  changes_requested: 'A reviewer asked for changes on the pull request',
  checks_failing: 'Checks are failing on the pull request',
};

/** What waits on the owner for this ticket, most urgent first. Empty when nothing does. */
export function needsYou({ run, pullRequests, demoUrl }: NeedFacts): NeedItem[] {
  const items: NeedItem[] = [];
  if (run?.waiting && !run.finished) {
    const { question, choices } = splitChoices(run.waiting);
    items.push({ id: 'question', kind: 'question', text: question, choices });
  }
  for (const item of run?.ac ?? []) {
    if (item.state === 'FAIL') items.push({ id: `ac-${item.n}`, kind: 'ac', text: item.text || `AC ${item.n}` });
  }
  const review = run?.reviewSignal ? REVIEW_TEXT[run.reviewSignal] : undefined;
  if (review) items.push({ id: 'review', kind: 'review', text: review });
  for (const pr of pullRequests ?? []) {
    if (pr.status?.toUpperCase() === 'CONFLICT') items.push({ id: `conflict-${pr.id ?? pr.repo}`, kind: 'conflict', text: `${pr.repo}#${pr.pullNumber ?? pr.number} has a merge conflict` });
  }
  const pastPr = run ? stepIndex(run.stage) >= stepIndex('pr') : false;
  if (pastPr && !demoUrl) items.push({ id: 'demo', kind: 'demo', text: 'No demo video yet' });
  return items;
}

/** A description longer than this many lines starts folded. */
export const DESCRIPTION_LINES = 8;

export const isLongDescription = (text?: string | null, lines = DESCRIPTION_LINES): boolean => (
  Boolean(text) && ((text as string).split('\n').length > lines || (text as string).length > lines * 110)
);
