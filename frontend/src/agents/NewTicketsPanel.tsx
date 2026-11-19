import React, { useEffect, useState } from 'react';
import { CheckCircle2, Info, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, Input, Select, Textarea } from '../components/ui';
import { cn } from '../lib/cn';
import { newTicketMissing, type DraftNewTicket, type NewTicketInput, type SprintDraft } from './planning';
import { NEW_TICKET_LIMIT, PRIORITIES, TICKET_TYPES, newTicketForm, newTicketInput, type NewTicketForm } from './boardLogic';

const label = 'block font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground';
const NO_DEV = '__none';

const Field: React.FC<{ name: string; wide?: boolean; warn?: boolean; children: React.ReactNode }> = ({ name, wide, warn, children }) => (
  <label className={cn('grid min-w-0 gap-1', wide && 'col-span-full')}>
    <span className={cn(label, warn && 'text-[var(--color-status-warn-ink)]')}>{name}</span>
    {children}
  </label>
);

const TicketForm: React.FC<{
  draft: SprintDraft; item: DraftNewTicket | null; busy: boolean;
  onSave: (id: string | null, input: NewTicketInput) => Promise<boolean>; onRemove?: () => void; onCancel?: () => void;
}> = ({ draft, item, busy, onSave, onRemove, onCancel }) => {
  const [form, setForm] = useState<NewTicketForm>(() => newTicketForm(item));
  const [error, setError] = useState<string | null>(null);
  const saved = JSON.stringify(newTicketForm(item));
  useEffect(() => setForm(JSON.parse(saved) as NewTicketForm), [saved]);
  const dirty = JSON.stringify(form) !== saved;
  const set = (field: keyof NewTicketForm) => (value: string) => setForm((current) => ({ ...current, [field]: value }));
  const text = (field: keyof NewTicketForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(field)(event.target.value);
  const devs = [...new Set([...draft.devs, ...(form.dev ? [form.dev] : [])])];
  const name = item?.id ?? 'the new ticket';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const { input, error: wrong } = newTicketInput(form);
    setError(wrong);
    if (wrong) return;
    if (await onSave(item?.id ?? null, item ? input : { ...input, source: 'manual' })) setError(null);
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="grid min-w-0 gap-2.5">
      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2.5 max-[1100px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[600px]:grid-cols-[minmax(0,1fr)]">
        <Field name="Type"><Select aria-label={`Type of ${name}`} className="h-9" value={form.type} onValueChange={set('type')} options={TICKET_TYPES.map((value) => ({ value, label: value }))} disabled={busy} /></Field>
        <Field name="Developer" warn={!form.dev}><Select aria-label={`Developer of ${name}`} className="h-9" value={form.dev || NO_DEV} onValueChange={(value) => set('dev')(value === NO_DEV ? '' : value)} options={[{ value: NO_DEV, label: 'Pick a developer' }, ...devs.map((value) => ({ value, label: value }))]} disabled={busy} /></Field>
        <Field name="SP"><Input aria-label={`SP of ${name}`} inputMode="decimal" className="h-9 px-2" value={form.sp} onChange={text('sp')} disabled={busy} /></Field>
        <Field name="Priority"><Select aria-label={`Priority of ${name}`} className="h-9" value={form.priority} onValueChange={set('priority')} options={PRIORITIES.map((value) => ({ value, label: value }))} disabled={busy} /></Field>
        <Field name="Epic"><Input aria-label={`Epic of ${name}`} className="h-9 px-2 font-mono" placeholder="No epic" value={form.epic} onChange={text('epic')} disabled={busy} /></Field>
        <Field name="Summary" wide warn={!form.summary.trim()}><Input aria-label={`Summary of ${name}`} className="h-9" maxLength={200} placeholder="[BE][Workflow] What changes" value={form.summary} onChange={text('summary')} disabled={busy} /></Field>
        <Field name="User story" wide warn={!form.userStory.trim()}><Textarea aria-label={`User story of ${name}`} className="min-h-16" maxLength={4000} placeholder="As a … I want … so …" value={form.userStory} onChange={text('userStory')} disabled={busy} /></Field>
        <Field name="Problem definition" wide warn={!form.problem.trim()}><Textarea aria-label={`Problem definition of ${name}`} className="min-h-16" maxLength={4000} value={form.problem} onChange={text('problem')} disabled={busy} /></Field>
        <Field name="Acceptance criteria · one line each" wide warn={!form.ac.trim()}><Textarea aria-label={`Acceptance criteria of ${name}`} className="min-h-24 font-mono text-[0.78rem]" value={form.ac} onChange={text('ac')} disabled={busy} /></Field>
        <Field name="Reference" wide><Textarea aria-label={`Reference of ${name}`} className="min-h-12" maxLength={2000} value={form.reference} onChange={text('reference')} disabled={busy} /></Field>
      </div>
      {error && <p className="text-sm text-status-conflict" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {onRemove && <Button type="button" size="sm" variant="ghost" onClick={onRemove} disabled={busy}><Trash2 size={13} aria-hidden="true" />Remove</Button>}
        {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}><X size={13} aria-hidden="true" />Cancel</Button>}
        {item && dirty && <Button type="button" size="sm" variant="ghost" onClick={() => setForm(JSON.parse(saved) as NewTicketForm)} disabled={busy}>Reset</Button>}
        <Button type="submit" size="sm" variant="primary" disabled={busy || (!!item && !dirty)}>{item ? <><Save size={13} aria-hidden="true" />Save</> : <><Plus size={13} aria-hidden="true" />Add ticket</>}</Button>
      </div>
    </form>
  );
};

/** Draft > New tickets: tickets not in Jira yet, written here or by the planning agent; Publish creates them in this sprint. */
export const NewTicketsPanel: React.FC<{
  draft: SprintDraft; busy: boolean;
  onSave: (id: string | null, input: NewTicketInput) => Promise<boolean>; onRemove: (id: string) => void;
}> = ({ draft, busy, onSave, onRemove }) => {
  const [adding, setAdding] = useState(false);
  const items = draft.newTickets ?? [];
  const full = items.length >= NEW_TICKET_LIMIT;
  return (
    <section aria-label="New tickets" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-pretty text-[0.8rem] text-sky-200"><Info size={13} className="flex-none" aria-hidden="true" />Tickets that are not in Jira yet. Publish creates them in this sprint, labelled dock-plan.</p>
        {items.length > 0 && !adding && <Button size="sm" onClick={() => setAdding(true)} disabled={busy || full} title={full ? `At most ${NEW_TICKET_LIMIT} new tickets per sprint` : undefined}><Plus size={13} aria-hidden="true" />New ticket</Button>}
      </div>
      {adding && (
        <div className="rounded-md border border-l-[3px] border-dashed border-sky-400 bg-surface-1 px-3 py-3">
          <p className="mb-2 font-display text-sm font-semibold">New ticket</p>
          <TicketForm draft={draft} item={null} busy={busy} onSave={async (id, input) => { const ok = await onSave(id, input); if (ok) setAdding(false); return ok; }} onCancel={() => setAdding(false)} />
        </div>
      )}
      {!items.length && !adding && (
        <div className="grid justify-items-center gap-3 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          <p className="text-pretty">No new ticket yet. Describe one in the chat, or use the chip <b className="text-secondary-foreground">Draft tickets from a sheet</b>.</p>
          <Button onClick={() => setAdding(true)} disabled={busy}><Plus size={14} aria-hidden="true" />New ticket</Button>
        </div>
      )}
      {items.map((item) => {
        const missing = newTicketMissing(item);
        return (
          <article key={item.id} aria-label={item.id} className={cn('min-w-0 rounded-md border border-l-[3px] bg-surface-1 px-3 py-3', item.createdKey ? 'border-border border-l-status-merged' : 'border-dashed border-sky-400')}>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-xs border border-sky-400 px-1.5 font-mono text-[0.66rem] font-bold text-sky-300">{item.id}</span>
              {item.createdKey && <span className="inline-flex items-center gap-1 font-mono text-[0.72rem] font-bold text-status-merged"><CheckCircle2 size={12} aria-hidden="true" />{item.createdKey}</span>}
              <b className="min-w-0 flex-1 text-pretty text-[0.84rem]">{item.summary || 'Untitled ticket'}</b>
            </p>
            <p className="mt-0.5 font-mono text-[0.66rem] text-muted-foreground">
              from {item.source} · {item.ac.length} AC {item.ac.length === 1 ? 'line' : 'lines'}{missing.length ? ` · missing ${missing.join(', ')}` : ''}
            </p>
            {item.error && <p className="mt-1 text-pretty text-[0.78rem] text-status-conflict" role="alert">Publish failed: {item.error}</p>}
            {item.createdKey
              ? <p className="mt-2 text-[0.78rem] text-secondary-foreground">Created in Jira as {item.createdKey}{item.dev ? ` · ${item.dev}` : ''}{item.sp !== null ? ` · ${item.sp} SP` : ''}. Change it in Jira from here on.</p>
              : <div className="mt-2"><TicketForm draft={draft} item={item} busy={busy} onSave={onSave} onRemove={() => onRemove(item.id)} /></div>}
          </article>
        );
      })}
    </section>
  );
};
