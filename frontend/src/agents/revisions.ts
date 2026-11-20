// The pure side of Planning > Tickets > Revisions: changes the planning agent wrote for tickets that already exist in Jira.
import type { DraftRevision, DraftRevisionField, RevisionInput, SprintDraft } from './planning';

export type RevisionFieldName = 'summary' | 'type' | 'userStory' | 'problem' | 'ac' | 'reference' | 'openToConfirm';

/** The fields a revision may change, in the order a card shows them, with each one's limit. */
export const REVISION_FIELDS: Array<{ name: RevisionFieldName; label: string; max: number }> = [
  { name: 'summary', label: 'Summary', max: 200 },
  { name: 'type', label: 'Type', max: 0 },
  { name: 'userStory', label: 'User story', max: 4000 },
  { name: 'problem', label: 'Problem definition', max: 4000 },
  { name: 'ac', label: 'Acceptance criteria', max: 1000 },
  { name: 'reference', label: 'Reference', max: 2000 },
  { name: 'openToConfirm', label: 'Open to confirm', max: 4000 },
];
export const REVISION_TYPES = ['Task', 'Story', 'Bug'];
export const REVISION_AC_LINES = 40;
export const REVISION_LIMIT = 30;

const known = (name: string): name is RevisionFieldName => REVISION_FIELDS.some((field) => field.name === name);
const order = (name: string) => { const at = REVISION_FIELDS.findIndex((field) => field.name === name); return at < 0 ? REVISION_FIELDS.length : at; };

/** A field's label: the server's when it sends one, else DOCK's own. */
export const revisionFieldLabel = (field: Pick<DraftRevisionField, 'name' | 'label'>) => field.label || REVISION_FIELDS.find((item) => item.name === field.name)?.label || field.name;

/** The revision's fields in the card's order. */
export const revisionFields = (revision: Pick<DraftRevision, 'fields'>) => [...revision.fields].sort((a, b) => order(a.name) - order(b.name));

export type DiffLine = { text: string; kind: 'same' | 'removed' | 'added' };

/** AC before and after as one list: lines kept, lines removed (shown struck) and lines added, in reading order. */
export function acLineDiff(before: string[], after: string[]): DiffLine[] {
  const rows = before.length;
  const cols = after.length;
  const common: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) common[i][j] = before[i] === after[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      lines.push({ text: before[i], kind: 'same' });
      i += 1;
      j += 1;
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      lines.push({ text: before[i], kind: 'removed' });
      i += 1;
    } else {
      lines.push({ text: after[j], kind: 'added' });
      j += 1;
    }
  }
  for (; i < rows; i += 1) lines.push({ text: before[i], kind: 'removed' });
  for (; j < cols; j += 1) lines.push({ text: after[j], kind: 'added' });
  return lines;
}

export const pendingRevisions = (draft: Pick<SprintDraft, 'revisions'>) => (draft.revisions ?? []).filter((revision) => revision.status === 'pending');

/** What Planning > Tickets still asks the planner to look at: new tickets not created yet and revisions not applied. */
export function ticketsToReview(draft: Pick<SprintDraft, 'newTickets' | 'revisions'>) {
  const fresh = (draft.newTickets ?? []).filter((item) => !item.createdKey).length;
  const revisions = pendingRevisions(draft).length;
  return { fresh, revisions, total: fresh + revisions };
}

/** A revision as its edit form holds it: one text per field it changes, AC one line per row. */
export type RevisionForm = Partial<Record<RevisionFieldName, string>>;

export const revisionForm = (revision: Pick<DraftRevision, 'fields'>): RevisionForm =>
  Object.fromEntries(revisionFields(revision).filter((field) => known(field.name)).map((field) => [field.name, field.after.join('\n')]));

/** The form as the save mutation takes it: every field of the revision with its edited after value, the note and source kept. */
export function revisionInput(form: RevisionForm, revision: Pick<DraftRevision, 'note' | 'source'>): { input: RevisionInput; error: string | null } {
  const input: RevisionInput = { note: revision.note ?? null, source: revision.source };
  for (const field of REVISION_FIELDS) {
    const value = form[field.name];
    if (value === undefined) continue;
    if (field.name === 'ac') {
      const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
      input.ac = lines;
      if (lines.length > REVISION_AC_LINES) return { input, error: `At most ${REVISION_AC_LINES} AC lines` };
      if (lines.some((line) => line.length > field.max)) return { input, error: `An AC line is at most ${field.max} characters` };
      continue;
    }
    const text = field.name === 'summary' ? value.replace(/\s+/g, ' ').trim() : value.trim();
    input[field.name] = text;
    if (field.name === 'summary' && !text) return { input, error: 'Write a summary' };
    if (field.name === 'type' && !REVISION_TYPES.includes(text)) return { input, error: `Type is ${REVISION_TYPES.join(', ')}` };
    if (field.max && text.length > field.max) return { input, error: `${field.label} is at most ${field.max} characters` };
  }
  return { input, error: null };
}

/** The confirmation's list of what Apply writes, by label. */
export const revisionFieldNames = (revision: Pick<DraftRevision, 'fields'>) => revisionFields(revision).map(revisionFieldLabel);
