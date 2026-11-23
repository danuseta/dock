import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Pencil, Plus, Save, Trash2, Volume2, X } from 'lucide-react';
import { Markdown } from '../../chat/Markdown';
import { Button, Input, Textarea } from '../../components/ui';
import { GET_KAMUS, SAVE_KAMUS } from '../../graphql/queries';
import { cn } from '../../lib/cn';
import { emptyRow, editorDoc, issueAt, kamusChanged, kamusInput, kamusIssues, kamusTable, spokenLine, type KamusDoc } from '../../lib/kamus';
import { KAMUS_FILE, withoutComments } from '../../lib/blackboard';

const label = 'block font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground';
const cell = 'h-9 min-w-0 px-2 font-mono text-[0.8rem]';

/** "Try a line": the sentence as the video would say it, by the same rules as tts.py. */
const TryLine: React.FC<{ doc: KamusDoc }> = ({ doc }) => {
  const [line, setLine] = useState('');
  const table = useMemo(() => kamusTable(doc.sections), [doc]);
  return (
    <section aria-label="Try a line" className="grid min-w-0 gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-2.5">
      <label className="grid min-w-0 gap-1">
        <span className={cn(label, 'flex items-center gap-1.5')}><Volume2 size={11} aria-hidden="true" />Try a line</span>
        <Input aria-label="A sentence to try" className="h-9" placeholder="Type a sentence, for example: DOCK and QRD-1234 are ready" value={line} onChange={(event) => setLine(event.target.value)} />
      </label>
      {line.trim() && (
        <p aria-label="Spoken as" className="min-w-0 text-pretty rounded-xs border border-border bg-surface-0 px-2 py-1.5 font-mono text-[0.78rem] text-foreground [overflow-wrap:anywhere]">{spokenLine(line, table)}</p>
      )}
    </section>
  );
};

const KamusEditor: React.FC<{ initial: KamusDoc; onDone: (saved: boolean) => void }> = ({ initial, onDone }) => {
  const start = useMemo(() => editorDoc(initial), [initial]);
  const [doc, setDoc] = useState<KamusDoc>(start);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [save, { loading }] = useMutation(SAVE_KAMUS);
  const issues = useMemo(() => kamusIssues(doc.sections), [doc]);
  const dirty = kamusChanged(start, doc);
  const setRow = (section: number, row: number, field: 'written' | 'spoken', value: string) => setDoc((current) => ({
    ...current, sections: current.sections.map((item, index) => (index === section ? { ...item, rows: item.rows.map((entry, position) => (position === row ? { ...entry, [field]: value } : entry)) } : item)),
  }));
  const change = (sections: KamusDoc['sections']) => setDoc((current) => ({ ...current, sections }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (issues.length) {
      setError(`Fix ${issues.length === 1 ? 'one mistake' : `${issues.length} mistakes`} first: ${issues[0].message}`);
      return;
    }
    try {
      await save({ variables: kamusInput(doc) });
      onDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The list could not be saved');
    }
  };
  const cancel = () => (dirty ? setDiscarding(true) : onDone(false));
  return (
    <form onSubmit={(event) => void submit(event)} className="grid min-w-0 gap-4 px-4 py-4 max-[760px]:px-3" aria-label="Edit the pronunciation list">
      <label className="grid min-w-0 gap-1">
        <span className={label}>Intro</span>
        <Textarea aria-label="Intro" className="min-h-20" maxLength={4000} value={doc.intro} onChange={(event) => setDoc({ ...doc, intro: event.target.value })} disabled={loading} />
      </label>
      {doc.sections.map((section, index) => {
        const titleIssue = issueAt(issues, index, -1, 'title');
        return (
          <fieldset key={index} className="grid min-w-0 gap-2 rounded-md border border-border bg-surface-0 px-3 py-3" aria-label={section.title || `Section ${index + 1}`}>
            <div className="flex min-w-0 flex-wrap items-end gap-2">
              <label className="grid min-w-0 flex-1 gap-1">
                <span className={label}>Section title</span>
                <Input aria-label={`Title of section ${index + 1}`} aria-invalid={!!titleIssue} className="h-9" maxLength={80} value={section.title} onChange={(event) => change(doc.sections.map((item, position) => (position === index ? { ...item, title: event.target.value } : item)))} disabled={loading} />
              </label>
              <Button type="button" size="sm" variant="ghost" onClick={() => change(doc.sections.filter((_, position) => position !== index))} disabled={loading} aria-label={`Remove section ${index + 1}`}><Trash2 size={13} aria-hidden="true" />Remove section</Button>
            </div>
            {titleIssue && <p className="text-[0.76rem] text-status-conflict" role="alert">Section {index + 1}: {titleIssue}</p>}
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 min-[761px]:grid"><span className={label}>Written</span><span className={label}>Spoken</span><span className="sr-only">Delete</span></div>
            {section.rows.map((row, position) => {
              const writtenIssue = issueAt(issues, index, position, 'written');
              const spokenIssue = issueAt(issues, index, position, 'spoken');
              return (
                <div key={position} className="grid min-w-0 gap-1">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-start gap-2 max-[760px]:grid-cols-[minmax(0,1fr)_2.75rem]">
                    <Input aria-label={`Written, section ${index + 1} row ${position + 1}`} aria-invalid={!!writtenIssue} className={cell} placeholder="Written" value={row.written} onChange={(event) => setRow(index, position, 'written', event.target.value)} disabled={loading} />
                    <Input aria-label={`Spoken, section ${index + 1} row ${position + 1}`} aria-invalid={!!spokenIssue} className={cn(cell, 'max-[760px]:col-start-1 max-[760px]:row-start-2')} placeholder="Spoken" value={row.spoken} onChange={(event) => setRow(index, position, 'spoken', event.target.value)} disabled={loading} />
                    <Button type="button" size="sm" variant="ghost" className="max-[760px]:col-start-2 max-[760px]:row-span-2 max-[760px]:row-start-1 max-[760px]:h-full" onClick={() => change(doc.sections.map((item, at) => (at === index ? { ...item, rows: item.rows.filter((_, rowAt) => rowAt !== position) } : item)))} disabled={loading} aria-label={`Delete row ${position + 1} of section ${index + 1}`}><Trash2 size={13} aria-hidden="true" /></Button>
                  </div>
                  {(writtenIssue || spokenIssue) && <p className="text-pretty text-[0.76rem] text-status-conflict [overflow-wrap:anywhere]" role="alert">Row {position + 1}: {[writtenIssue && `written ${writtenIssue.replace(/^written /, '')}`, spokenIssue && `spoken ${spokenIssue.replace(/^spoken /, '')}`].filter(Boolean).join('; ')}</p>}
                </div>
              );
            })}
            <div><Button type="button" size="sm" onClick={() => change(doc.sections.map((item, at) => (at === index ? { ...item, rows: [...item.rows, emptyRow()] } : item)))} disabled={loading}><Plus size={13} aria-hidden="true" />Add row</Button></div>
          </fieldset>
        );
      })}
      <div><Button type="button" size="sm" variant="ghost" onClick={() => change([...doc.sections, { title: '', rows: [emptyRow()] }])} disabled={loading}><Plus size={13} aria-hidden="true" />Add section</Button></div>
      <TryLine doc={doc} />
      {issues.find((item) => item.field === 'list') && <p className="text-sm text-status-conflict" role="alert">{issues.find((item) => item.field === 'list')!.message}</p>}
      {error && <p className="text-pretty text-sm text-status-conflict [overflow-wrap:anywhere]" role="alert">{error}</p>}
      {discarding && (
        <div role="alertdialog" aria-label="Discard your changes?" className="flex flex-wrap items-center gap-2 rounded-md border border-status-warn bg-background px-3 py-2 text-[0.82rem]">
          <span className="min-w-0 flex-1">Discard your changes to the list?</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDiscarding(false)}>Keep editing</Button>
          <Button type="button" size="sm" onClick={() => onDone(false)}>Discard</Button>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={cancel} disabled={loading}><X size={13} aria-hidden="true" />Cancel</Button>
        <Button type="submit" size="sm" variant="primary" disabled={loading || !dirty}><Save size={13} aria-hidden="true" />{loading ? 'Saving...' : 'Save'}</Button>
      </div>
    </form>
  );
};

/** Blackboard > kamus-pengucapan.md: the rendered file, with Edit for the owner and a box to try a line. */
export const KamusView: React.FC<{ text: string | null; onSaved: () => void }> = ({ text, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const { data, refetch } = useQuery<{ kamus: { exists: boolean; intro: string; sections: KamusDoc['sections'] } }>(GET_KAMUS, { fetchPolicy: 'cache-and-network' });
  useEffect(() => { void refetch().catch(() => undefined); }, [text]);
  const doc: KamusDoc = { intro: data?.kamus.intro ?? '', sections: data?.kamus.sections ?? [] };
  if (editing) {
    return <KamusEditor initial={doc} onDone={(saved) => { setEditing(false); if (saved) onSaved(); }} />;
  }
  return (
    <div className="grid min-w-0 gap-4 px-6 py-5 max-[760px]:px-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[0.76rem] text-muted-foreground">The demo-video skill reads this list: the written form on the left is said as the form on the right.</p>
        <Button size="sm" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden="true" />Edit</Button>
      </div>
      {text
        ? <div className="min-w-0 overflow-x-auto text-[0.82rem] leading-relaxed text-secondary-foreground"><Markdown text={withoutComments(text)} /></div>
        : <p className="text-sm text-muted-foreground">No pronunciation glossary yet. Use Edit to start {KAMUS_FILE}.</p>}
      <TryLine doc={doc} />
    </div>
  );
};
