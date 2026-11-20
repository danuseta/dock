import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Info, Pencil, Save, Send, Trash2, X } from 'lucide-react';
import { Button, Input, Select, Textarea } from '../components/ui';
import { cn } from '../lib/cn';
import { whenText, type DraftRevision, type DraftRevisionField, type NewTicketInput, type PublishResult, type RevisionInput, type SprintDraft } from './planning';
import { REVISION_TYPES, acLineDiff, revisionFieldLabel, revisionFieldNames, revisionFields, revisionForm, revisionInput, ticketsToReview, type RevisionFieldName, type RevisionForm } from './revisions';
import { NewTicketsPanel } from './NewTicketsPanel';

const label = 'block font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground';
const chip = 'inline-flex items-center rounded-pill border px-2 font-mono text-[0.64rem]';
const wrap = 'whitespace-pre-wrap text-pretty [overflow-wrap:anywhere]';

const Lines: React.FC<{ lines: string[]; muted?: boolean }> = ({ lines, muted }) => (
  lines.length && lines.some((line) => line.trim())
    ? <p className={cn(wrap, 'text-[0.8rem]', muted && 'text-muted-foreground')}>{lines.join('\n')}</p>
    : <p className="text-[0.78rem] italic text-muted-foreground">empty</p>
);

const FieldChange: React.FC<{ field: DraftRevisionField }> = ({ field }) => (
  <div className="grid min-w-0 gap-1">
    <span className={label}>{revisionFieldLabel(field)}</span>
    {field.name === 'ac' ? (
      <ul aria-label={`${revisionFieldLabel(field)} changes`} className="grid min-w-0 gap-0.5 font-mono text-[0.76rem]">
        {acLineDiff(field.before, field.after).map((line, index) => (
          <li
            key={`${index}-${line.kind}`}
            className={cn('flex min-w-0 gap-1.5 rounded-xs px-1.5 py-0.5', line.kind === 'removed' && 'bg-status-conflict/10 text-status-conflict line-through', line.kind === 'added' && 'bg-status-merged/10 text-status-merged')}
          >
            <span className="flex-none select-none" aria-label={line.kind}>{line.kind === 'removed' ? '-' : line.kind === 'added' ? '+' : ' '}</span>
            <span className={cn('min-w-0', wrap)}>{line.text}</span>
          </li>
        ))}
      </ul>
    ) : (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 max-[760px]:grid-cols-[minmax(0,1fr)]">
        <div className="min-w-0"><span className={label}>Before</span><Lines lines={field.before} muted /></div>
        <div className="min-w-0"><span className={label}>After</span><Lines lines={field.after} /></div>
      </div>
    )}
  </div>
);

const RevisionEdit: React.FC<{ revision: DraftRevision; busy: boolean; onSave: (input: RevisionInput) => Promise<boolean>; onCancel: () => void }> = ({ revision, busy, onSave, onCancel }) => {
  const saved = JSON.stringify(revisionForm(revision));
  const [form, setForm] = useState<RevisionForm>(() => revisionForm(revision));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm(JSON.parse(saved) as RevisionForm), [saved]);
  const dirty = JSON.stringify(form) !== saved;
  const set = (name: RevisionFieldName) => (value: string) => setForm((current) => ({ ...current, [name]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const { input, error: wrong } = revisionInput(form, revision);
    setError(wrong);
    if (wrong) return;
    if (await onSave(input)) onCancel();
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="grid min-w-0 gap-2.5">
      {revisionFields(revision).map((field) => {
        const name = field.name as RevisionFieldName;
        const value = form[name];
        if (value === undefined) return null;
        const text = revisionFieldLabel(field);
        const aria = `${text} of ${revision.key}`;
        return (
          <label key={field.name} className="grid min-w-0 gap-1">
            <span className={label}>{name === 'ac' ? `${text} · one line each` : text}</span>
            {name === 'type'
              ? <Select aria-label={aria} className="h-9" value={value} onValueChange={set(name)} options={[...new Set([...REVISION_TYPES, value])].map((type) => ({ value: type, label: type }))} disabled={busy} />
              : name === 'summary'
                ? <Input aria-label={aria} className="h-9" maxLength={200} value={value} onChange={(event) => set(name)(event.target.value)} disabled={busy} />
                : <Textarea aria-label={aria} className={cn(name === 'ac' ? 'min-h-24 font-mono text-[0.78rem]' : 'min-h-16')} value={value} onChange={(event) => set(name)(event.target.value)} disabled={busy} />}
          </label>
        );
      })}
      {error && <p className="text-sm text-status-conflict" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}><X size={13} aria-hidden="true" />Cancel</Button>
        <Button type="submit" size="sm" variant="primary" disabled={busy || !dirty}><Save size={13} aria-hidden="true" />Save</Button>
      </div>
    </form>
  );
};

const RevisionCard: React.FC<{
  revision: DraftRevision; busy: boolean;
  onSave: (key: string, input: RevisionInput) => Promise<boolean>; onApply: (key: string) => Promise<PublishResult | null>; onDiscard: (key: string) => void; onOpenTicket: (key: string) => void;
}> = ({ revision, busy, onSave, onApply, onDiscard, onOpenTicket }) => {
  const applied = revision.status === 'applied';
  const [open, setOpen] = useState(!applied);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  useEffect(() => { if (applied) { setOpen(false); setEditing(false); setAsking(false); } }, [applied]);
  const names = revisionFieldNames(revision);
  const apply = async () => {
    setResult(await onApply(revision.key));
    setAsking(false);
  };
  const failed = result && result.status !== 'updated' ? result : null;
  return (
    <article aria-label={revision.key} className={cn('min-w-0 rounded-md border border-l-[3px] bg-surface-1 px-3 py-3', applied ? 'border-border border-l-status-merged' : 'border-dashed border-sky-400')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {applied && (
          <button type="button" className="flex-none text-muted-foreground" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? `Hide the changes of ${revision.key}` : `Show the changes of ${revision.key}`}>
            {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
        )}
        <button type="button" className="flex-none font-mono text-[0.76rem] font-bold text-accent hover:underline" onClick={() => onOpenTicket(revision.key)}>{revision.key}</button>
        <b className="min-w-0 flex-1 text-pretty text-[0.84rem] [overflow-wrap:anywhere]">{revision.summary}</b>
        <span className={cn(chip, revision.inSprint ? 'border-sky-400/60 text-sky-300' : 'border-border text-muted-foreground')}>{revision.inSprint ? 'in this sprint' : 'backlog'}</span>
        {!applied && !editing && !asking && (
          <span className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy}><Pencil size={13} aria-hidden="true" />Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => onDiscard(revision.key)} disabled={busy}><Trash2 size={13} aria-hidden="true" />Discard</Button>
            <Button size="sm" variant="primary" onClick={() => { setResult(null); setAsking(true); }} disabled={busy || !revision.fields.length}><Send size={13} aria-hidden="true" />Apply to Jira</Button>
          </span>
        )}
      </div>
      <p className="mt-0.5 font-mono text-[0.66rem] text-muted-foreground">
        from {revision.source} · {names.length} {names.length === 1 ? 'field' : 'fields'} · written {whenText(revision.createdAt)}
      </p>
      {applied && <p className="mt-1 inline-flex items-center gap-1 text-[0.78rem] text-status-merged"><CheckCircle2 size={13} aria-hidden="true" />Applied to Jira {whenText(revision.appliedAt)}</p>}
      {revision.note && <p className={cn('mt-1 text-[0.8rem] text-secondary-foreground', wrap)}>{revision.note}</p>}
      {revision.error && <p className={cn('mt-1 text-[0.78rem] text-status-conflict', wrap)} role="alert">Apply failed: {revision.error}</p>}
      {failed && failed.detail !== revision.error && <p className={cn('mt-1 text-[0.78rem] text-status-conflict', wrap)} role="alert">{failed.status === 'refused' ? 'Refused' : 'Apply failed'}: {failed.detail ?? failed.status}</p>}
      {asking && (
        <div role="alertdialog" aria-label={`Apply ${revision.key} to Jira`} className="mt-2 rounded-md border border-sky-400 bg-background px-3 py-3 text-[0.8rem]">
          <p className="font-display text-sm font-semibold">Apply the revision of {revision.key} to Jira?</p>
          <p className="mt-1.5 text-pretty text-secondary-foreground">Only these fields change: <b className="text-foreground">{names.join(', ')}</b>. Assignee, sprint, status and every other field stay untouched.</p>
          <div className="mt-2.5 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={busy}><X size={13} aria-hidden="true" />Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => void apply()} disabled={busy}><Send size={13} aria-hidden="true" />{busy ? 'Applying...' : 'Apply to Jira'}</Button>
          </div>
        </div>
      )}
      {open && (
        <div className="mt-2.5 grid min-w-0 gap-3">
          {editing
            ? <RevisionEdit revision={revision} busy={busy} onSave={(input) => onSave(revision.key, input)} onCancel={() => setEditing(false)} />
            : revisionFields(revision).map((field) => <FieldChange key={field.name} field={field} />)}
        </div>
      )}
    </article>
  );
};

/** Planning > Tickets > Revisions: changes the planning agent wrote for tickets already in Jira; Apply to Jira writes only the fields shown. */
export const RevisionsPanel: React.FC<{
  draft: SprintDraft; busy: boolean;
  onSave: (key: string, input: RevisionInput) => Promise<boolean>; onApply: (key: string) => Promise<PublishResult | null>; onDiscard: (key: string) => void; onOpenTicket: (key: string) => void;
}> = ({ draft, busy, onSave, onApply, onDiscard, onOpenTicket }) => {
  const items = draft.revisions ?? [];
  return (
    <section aria-label="Revisions" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <p className="flex min-w-0 items-center gap-1.5 text-pretty text-[0.8rem] text-sky-200"><Info size={13} className="flex-none" aria-hidden="true" />Changes the planning agent wrote for tickets already in Jira. Apply to Jira writes only the fields shown; assignee, sprint and status stay as they are.</p>
      {!items.length && (
        <div className="grid justify-items-center gap-3 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          <p className="text-pretty">No revision yet. Ask the planning chat to rewrite a ticket, or use the chip <b className="text-secondary-foreground">Rewrite a ticket</b> and paste the keys.</p>
        </div>
      )}
      {items.map((revision) => <RevisionCard key={`${revision.key}-${revision.createdAt}`} revision={revision} busy={busy} onSave={onSave} onApply={onApply} onDiscard={onDiscard} onOpenTicket={onOpenTicket} />)}
    </section>
  );
};

/** Planning > Tickets: the new tickets not in Jira yet, and the revisions of tickets that are. */
export const TicketsPanel: React.FC<{
  draft: SprintDraft; busy: boolean;
  onSaveNew: (id: string | null, input: NewTicketInput) => Promise<boolean>; onRemoveNew: (id: string) => void; onCreateNew: (ids: string[]) => Promise<PublishResult[]>;
  onSaveRevision: (key: string, input: RevisionInput) => Promise<boolean>; onApplyRevision: (key: string) => Promise<PublishResult | null>; onDiscardRevision: (key: string) => void; onOpenTicket: (key: string) => void;
}> = ({ draft, busy, onSaveNew, onRemoveNew, onCreateNew, onSaveRevision, onApplyRevision, onDiscardRevision, onOpenTicket }) => {
  const counts = ticketsToReview(draft);
  if (!draft.newTickets?.length && !draft.revisions?.length) {
    return (
      <section aria-label="Tickets" className="grid justify-items-center gap-3 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        <p className="text-pretty">Nothing to review yet. Ask the planning chat to draft new tickets or to rewrite tickets that already exist: use the chips <b className="text-secondary-foreground">Draft tickets from a sheet</b> or <b className="text-secondary-foreground">Rewrite a ticket</b>.</p>
      </section>
    );
  }
  const heading = (text: string, count: number) => <h3 className="font-display text-sm font-semibold">{text}{count > 0 && <span className="ml-1.5 font-mono text-[0.72rem] font-normal text-sky-300">{count} to review</span>}</h3>;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        {heading('New', counts.fresh)}
        <NewTicketsPanel draft={draft} busy={busy} onSave={onSaveNew} onRemove={onRemoveNew} onCreate={onCreateNew} />
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        {heading('Revisions', counts.revisions)}
        <RevisionsPanel draft={draft} busy={busy} onSave={onSaveRevision} onApply={onApplyRevision} onDiscard={onDiscardRevision} onOpenTicket={onOpenTicket} />
      </div>
    </div>
  );
};
