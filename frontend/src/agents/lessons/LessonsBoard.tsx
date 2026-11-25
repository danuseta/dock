import React, { useState } from 'react';
import { Code2, Pencil, Route, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, Input, Select, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import {
  LESSON_TARGETS, SOURCE_STATUS_LABELS, TARGET_LABELS, canMakeCode, filterLessons, lessonCounts, sourceLabel, statusChips, targetLabel, targetProblem,
  type Lesson, type LessonFilter, type LessonsData,
} from './lessonsLogic';

export interface LessonActions {
  edit(id: string, text: string): Promise<unknown>;
  retarget(id: string, kind: string, name: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  approve(id: string): Promise<unknown>;
}

const FILTERS: LessonFilter[] = ['all', ...LESSON_TARGETS];
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'The change failed');

const LessonCard: React.FC<{ lesson: Lesson; actions: LessonActions; busy: boolean }> = ({ lesson, actions, busy }) => {
  const [mode, setMode] = useState<'view' | 'edit' | 'target'>('view');
  const [text, setText] = useState(lesson.text);
  const [kind, setKind] = useState(lesson.targetKind);
  const [name, setName] = useState(lesson.targetName);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<unknown>) => { setError(null); void work().then(() => setMode('view'), (reason) => setError(errorText(reason))); };
  const problem = mode === 'target' ? targetProblem(kind, name) : null;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface-1 p-4 shadow-card" aria-label={`Lesson for ${targetLabel(lesson)}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-display font-semibold text-foreground">{targetLabel(lesson)}</span>
        <Badge>{lesson.cause}</Badge>
        <Badge variant={lesson.count >= 2 ? 'warn' : 'neutral'}>{lesson.count}×</Badge>
        {lesson.ticketKeys.length > 0 && <span className="font-mono text-xs text-muted-foreground">{lesson.ticketKeys.join(', ')}</span>}
        <span className="ml-auto flex flex-wrap gap-1.5">{statusChips(lesson).map((chip) => <Badge key={chip.label} variant={chip.variant}>{chip.label}</Badge>)}</span>
      </header>
      {mode === 'edit' ? (
        <div className="flex flex-col gap-2">
          <Textarea value={text} onChange={(event) => setText(event.target.value)} aria-label="Lesson text" rows={3} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={() => run(() => actions.edit(lesson.id, text))}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setText(lesson.text); setMode('view'); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="text-pretty text-sm text-foreground">{lesson.text}</p>
      )}
      {mode === 'target' && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onValueChange={setKind} aria-label="Target kind" className="w-40" options={LESSON_TARGETS.map((value) => ({ value, label: TARGET_LABELS[value] }))} />
          <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Target name" placeholder={kind === 'flow' ? 'sous' : 'demo-video'} className="max-w-xs" disabled={kind === 'flow'} />
          <Button size="sm" variant="primary" disabled={busy || !!problem} onClick={() => run(() => actions.retarget(lesson.id, kind, kind === 'flow' ? 'sous' : name))}>Move</Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
          {problem && <span className="text-xs text-status-warn">{problem}</span>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        From {lesson.sources.length ? lesson.sources.map(sourceLabel).join(', ') : 'no recorded source'} · written to <span className="font-mono">{lesson.writtenTo}</span>
      </p>
      {error && <p className="text-xs text-status-conflict" role="alert">{error}</p>}
      <footer className="flex flex-wrap gap-2">
        {canMakeCode(lesson) && <Button size="sm" variant={lesson.cardState === 'pending' ? 'primary' : 'default'} disabled={busy} onClick={() => run(() => actions.approve(lesson.id))}><Code2 size={14} aria-hidden="true" />Jadikan aturan di kode</Button>}
        {lesson.status !== 'coded' && <Button size="sm" variant="ghost" onClick={() => setMode('edit')}><Pencil size={14} aria-hidden="true" />Edit</Button>}
        {lesson.status !== 'coded' && <Button size="sm" variant="ghost" onClick={() => setMode('target')}><Route size={14} aria-hidden="true" />Change target</Button>}
        <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}><Trash2 size={14} aria-hidden="true" />Delete</Button>
      </footer>
      <ConfirmDialog open={confirm} title="Delete this lesson?" description="It leaves every file and prompt it was written to. Its sources stay counted." confirmLabel="Delete" busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); run(() => actions.remove(lesson.id)); }} />
    </article>
  );
};

/** The Lessons tab without data fetching: the unprocessed count, the target filter and the lesson cards. */
export const LessonsBoard: React.FC<{ data: LessonsData; actions: LessonActions; busy?: boolean; initialFilter?: LessonFilter }> = ({ data, actions, busy = false, initialFilter = 'all' }) => {
  const [filter, setFilter] = useState<LessonFilter>(initialFilter);
  const counts = lessonCounts(data.lessons);
  const shown = filterLessons(data.lessons, filter);
  return (
    <section aria-label="Agent lessons" className="flex flex-col gap-4">
      <div className="grid grid-cols-[auto_1fr] items-center gap-4 rounded-md border border-border bg-surface-1 p-4 max-[700px]:grid-cols-1">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Not processed</p>
          <p className={cn('font-display text-4xl font-black tabular-nums', data.unprocessed === 0 ? 'text-status-merged' : 'text-status-warn')} aria-label={`${data.unprocessed} sources not processed`}>{data.unprocessed}</p>
          <p className="text-xs text-muted-foreground">target 0 · {data.sources} sources</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.byStatus.filter((row) => row.status !== 'pending').map((row) => <Badge key={row.status}>{SOURCE_STATUS_LABELS[row.status] ?? row.status} {row.count}</Badge>)}
        </div>
      </div>
      {data.failed.length > 0 && (
        <Card className="border-status-warn p-4 text-sm" role="alert">
          {data.failed.length} source{data.failed.length > 1 ? 's' : ''} could not be processed yet: {data.failed.slice(0, 3).map((item) => item.error).join('; ')}
        </Card>
      )}
      <div className="flex flex-wrap rounded-sm border border-border bg-surface-1 p-0.5 self-start" role="group" aria-label="Lesson targets shown">
        {FILTERS.map((id) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn('flex h-8 items-center gap-1.5 rounded-xs px-3 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150 max-[760px]:h-11', filter === id && 'bg-accent text-black')}>
            {id === 'all' ? 'All' : TARGET_LABELS[id]}<span className="font-mono tabular-nums opacity-70">{counts[id]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <Card className="text-sm text-muted-foreground">{data.lessons.length === 0 ? 'No lessons yet. Judge findings and closed ticket ledgers land here.' : 'No lesson for this target.'}</Card>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3 max-[760px]:grid-cols-1">
        {shown.map((lesson) => <LessonCard key={`${lesson.id}-${lesson.updatedAt}`} lesson={lesson} actions={actions} busy={busy} />)}
      </div>
      {data.environment.length > 0 && (
        <div>
          <h2 className="mb-2 font-display text-sm font-semibold">Environment notices</h2>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {data.environment.map((item) => <li key={item.id}><span className="font-mono text-xs">{item.ticketKey ?? item.kind}</span> {item.text}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
};
