export interface ChatInteraction {
  id: number;
  sessionId: string;
  turnId: number;
  kind: string;
  title: string;
  body: string;
  state: string;
  createdAt: string;
  expiresAt: string;
  answeredAt?: string | null;
}

export interface SettledInteraction { id: number; state: string; decision?: string | null }

export interface QuestionOption { label: string; description: string }
export interface QuestionItem { question: string; header: string; multiSelect: boolean; options: QuestionOption[] }

export interface PermissionBody {
  kind: 'permission';
  tool: string;
  label: string;
  summary: string;
  detail: string;
  agent: string | null;
  alwaysLabel: string | null;
}
export interface QuestionBody { kind: 'question'; questions: QuestionItem[] }
export interface PlanBody { kind: 'plan'; planChars: number }
export type InteractionBody = PermissionBody | QuestionBody | PlanBody;

export type PermissionDecision = 'allow' | 'allow_session' | 'deny';
export type PlanDecision = 'approve' | 'approve_edits' | 'reject';
export interface AnswerChoice { index: number; labels: string[]; other: string | null }
export interface AnswerVariables {
  decision: string;
  answers?: AnswerChoice[];
  note?: string;
}
export interface QuestionSelection { picked: number[]; other: string }

export interface SettledLine { id: number; kind: string; title: string; outcome: string; at: number }

export const MAX_NOTE = 500;
export const MAX_SETTLED = 3;
export const SETTLED_TTL_MS = 5 * 60 * 1000;

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const optionalText = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function parseQuestions(value: unknown): QuestionItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const questions: QuestionItem[] = [];
  for (const raw of value) {
    const item = record(raw);
    const question = item ? text(item.question) : null;
    if (!item || question === null || !Array.isArray(item.options) || item.options.length === 0) return null;
    const options: QuestionOption[] = [];
    for (const rawOption of item.options) {
      const option = record(rawOption);
      const label = option ? text(option.label) : null;
      if (!option || !label) return null;
      options.push({ label, description: text(option.description) ?? '' });
    }
    questions.push({ question, header: text(item.header) ?? '', multiSelect: item.multiSelect === true, options });
  }
  return questions;
}

export function parseBody(interaction: Pick<ChatInteraction, 'kind' | 'body'>): InteractionBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(interaction.body);
  } catch {
    return null;
  }
  const body = record(parsed);
  if (!body) return null;
  if (interaction.kind === 'permission') {
    const tool = text(body.tool);
    const label = text(body.label);
    const summary = text(body.summary);
    const detail = text(body.detail);
    if (tool === null || label === null || summary === null || detail === null) return null;
    return { kind: 'permission', tool, label, summary, detail, agent: optionalText(body.agent), alwaysLabel: optionalText(body.alwaysLabel) };
  }
  if (interaction.kind === 'question') {
    const questions = parseQuestions(body.questions);
    return questions ? { kind: 'question', questions } : null;
  }
  if (interaction.kind === 'plan') {
    return { kind: 'plan', planChars: typeof body.planChars === 'number' && Number.isFinite(body.planChars) ? body.planChars : 0 };
  }
  return null;
}

export function countdown(expiresAt: string, now: number): { text: string; expired: boolean } {
  const left = Math.floor((Date.parse(expiresAt) - now) / 1000);
  if (!Number.isFinite(left) || left <= 0) return { text: 'Expired', expired: true };
  return { text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, expired: false };
}

export const isAnswerable = (interaction: Pick<ChatInteraction, 'state' | 'expiresAt'>, now: number): boolean => interaction.state === 'pending' && !countdown(interaction.expiresAt, now).expired;

export const permissionButtons = (body: { alwaysLabel: string | null }): PermissionDecision[] => (body.alwaysLabel ? ['deny', 'allow', 'allow_session'] : ['deny', 'allow']);

const cleanNote = (note: string): string => note.trim().slice(0, MAX_NOTE);

export const permissionAnswer = (decision: PermissionDecision): AnswerVariables => ({ decision });

export function planAnswer(decision: PlanDecision, note: string): AnswerVariables {
  const clean = cleanNote(note);
  return clean ? { decision, note: clean } : { decision };
}

export const questionDismissal = (): AnswerVariables => ({ decision: 'deny' });

export const toggleChoice = <T,>(selected: readonly T[], value: T, multiSelect: boolean): T[] => {
  if (selected.includes(value)) return selected.filter((item) => item !== value);
  return multiSelect ? [...selected, value] : [value];
};

const answered = (selection: QuestionSelection | undefined): boolean => Boolean(selection && (selection.picked.length > 0 || selection.other.trim()));

export const canSubmitQuestion = (questions: readonly QuestionItem[], selections: readonly QuestionSelection[]): boolean => questions.every((_, index) => answered(selections[index]));

export function questionAnswer(questions: readonly QuestionItem[], selections: readonly QuestionSelection[]): (AnswerVariables & { answers: AnswerChoice[] }) | null {
  if (!canSubmitQuestion(questions, selections)) return null;
  const answers = questions.map((_, index): AnswerChoice => {
    const other = selections[index].other.trim().slice(0, MAX_NOTE);
    if (other) return { index, labels: [], other };
    const options = questions[index].options;
    return { index, labels: selections[index].picked.flatMap((at) => (options[at] ? [options[at].label] : [])), other: null };
  });
  return { decision: 'answer', answers };
}

const OUTCOMES: Record<string, string> = {
  allow: 'Allowed',
  allow_session: 'Allowed for this session',
  deny: 'Denied',
  answer: 'Answered',
  approve: 'Plan approved',
  approve_edits: 'Plan approved, edits allowed',
  reject: 'Plan sent back',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export function settledOutcome(kind: string, decision: string): string {
  if (decision === 'deny' && kind === 'question') return 'Dismissed';
  return OUTCOMES[decision] ?? 'Closed';
}

export function settle(log: readonly SettledLine[], line: SettledLine, now: number): SettledLine[] {
  const kept = freshLines(log, now).filter((item) => item.id !== line.id);
  return [...kept, line].slice(-MAX_SETTLED);
}

export const freshLines = (log: readonly SettledLine[], now: number): SettledLine[] => log.filter((item) => now - item.at < SETTLED_TTL_MS);

export function closedSince(
  previous: readonly ChatInteraction[],
  next: readonly ChatInteraction[],
  log: readonly SettledLine[],
  now: number,
  settled: readonly SettledInteraction[] = [],
): SettledLine[] {
  const open = new Set(next.filter((item) => item.state === 'pending').map((item) => item.id));
  const logged = new Set(log.map((item) => item.id));
  const outcomeOf = (item: ChatInteraction) => {
    const known = settled.find((entry) => entry.id === item.id);
    if (known) return settledOutcome(item.kind, known.state === 'answered' && known.decision ? known.decision : known.state);
    return settledOutcome(item.kind, Date.parse(item.expiresAt) <= now ? 'expired' : 'cancelled');
  };
  return previous
    .filter((item) => item.state === 'pending' && !open.has(item.id) && !logged.has(item.id))
    .map((item) => ({ id: item.id, kind: item.kind, title: item.title, outcome: outcomeOf(item), at: now }));
}

export const visiblePending = (pending: readonly ChatInteraction[], log: readonly SettledLine[]): ChatInteraction[] => {
  const logged = new Set(log.map((item) => item.id));
  return pending.filter((item) => item.state === 'pending' && !logged.has(item.id));
};

export function planTextFor(messages: ReadonlyArray<{ id: number; role: string; text: string }>, turnId: number): string | null {
  let found: string | null = null;
  for (const message of messages) {
    if (message.id <= turnId) continue;
    if (message.role === 'user') break;
    if (message.role === 'assistant' && message.text) found = message.text;
  }
  return found;
}
