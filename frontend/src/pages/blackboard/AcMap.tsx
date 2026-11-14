import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, CircleDashed, FileCode, FlaskConical, GitPullRequest, Route } from 'lucide-react';
import { Checkbox } from '../../components/ui';
import { cn } from '../../lib/cn';
import { NOTHING_YET, coverageText, hasCode, missingOnly, traceGroups, type AcRef, type AcTrace, type AcTraceLine, type AcTracePull } from '../../lib/acTrace';
import { patchFor, refDisplay, snippetAround, type PullPatch } from '../../lib/acSnippet';

const STATE_TONE: Record<string, string> = {
  PASS: 'border-status-merged/40 bg-status-merged-bg text-status-merged',
  FAIL: 'border-status-conflict/40 bg-status-conflict-bg text-status-conflict',
  TODO: 'border-border bg-surface-2 text-secondary-foreground',
};

const chip = (text: string, ok: boolean) => (
  <span className={cn('inline-flex items-center rounded-xs px-1.5 py-px font-mono text-[0.66rem] font-bold', ok ? 'bg-status-merged-bg text-status-merged' : 'bg-status-warn-bg text-status-warn')}>{text}</span>
);

const RefButton: React.FC<{ value: AcRef; pulls: AcTracePull[]; onOpen: (ref: AcRef) => void }> = ({ value, pulls, onOpen }) => {
  const shown = refDisplay(value, pulls);
  return (
    <button type="button" title={shown.title ?? undefined} onClick={(event) => { event.stopPropagation(); onOpen(value); }} className="inline-flex max-w-full items-center gap-1 rounded-xs bg-surface-2 px-1 py-px text-left font-mono text-[0.72rem] text-accent hover:underline">
      <FileCode size={11} aria-hidden="true" className="flex-none" /><span className="truncate">{shown.label}</span>
    </button>
  );
};

const SNIPPET_ROW = 'grid min-w-full w-max grid-cols-[3rem_3rem_1.25rem_minmax(0,1fr)] font-mono text-[0.72rem] leading-5';

/** The diff lines around a path:line from the pull request Perubahan kode loads; "snippet belum ada" when it has none. */
export const RefSnippet: React.FC<{ value: AcRef; pulls: AcTracePull[]; files: PullPatch[] | null }> = ({ value, pulls, files }) => {
  if (files === null) return <p className="mt-1 text-xs text-muted-foreground" role="status">Loading snippet...</p>;
  const rows = snippetAround(patchFor(value, files, pulls)?.patch ?? null, value.line);
  if (!rows) return <p className="mt-1 text-xs text-muted-foreground">snippet belum ada</p>;
  return (
    <div className="mt-1 overflow-x-auto rounded-sm border border-border bg-background">
      {rows.map((row, index) => (
        <div key={index} className={cn(SNIPPET_ROW, row.kind === 'add' ? 'bg-status-merged/[0.09]' : row.kind === 'del' ? 'bg-status-conflict/[0.09]' : '', row.hit && '!bg-status-warn/15 shadow-[inset_3px_0_0_var(--color-status-warn)]')}>
          <span className="select-none px-2 text-right text-muted-foreground tabular-nums">{row.oldLine ?? ''}</span>
          <span className="select-none px-2 text-right text-muted-foreground tabular-nums">{row.newLine ?? ''}</span>
          <span className={cn('select-none', row.kind === 'add' ? 'text-status-merged' : row.kind === 'del' ? 'text-status-conflict' : 'text-muted-foreground')}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>
          <span className="whitespace-pre pr-3 text-secondary-foreground">{row.text}</span>
        </div>
      ))}
    </div>
  );
};

/** One AC line opened: its English text, the Indonesian line, every path:line with its snippet, the tests that cover it and the pull request. */
export const AcLineDetail: React.FC<{ line: AcTraceLine; pulls: AcTracePull[]; files: PullPatch[] | null; onOpenRef: (ref: AcRef) => void }> = ({ line, pulls, files, onOpenRef }) => (
  <div className="my-1 rounded-sm border border-border bg-surface-0 px-3 py-2.5 text-[0.8rem]">
    <p className="text-pretty text-foreground">{line.text ?? NOTHING_YET}</p>
    {line.textId && <p className="mt-0.5 text-pretty text-muted-foreground">{line.textId}</p>}
    <p className="mt-2.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">path:line</p>
    {line.refs.length
      ? <ul className="mt-1 flex flex-col gap-2">{line.refs.map((ref) => <li key={ref.text} className="min-w-0"><span className="flex flex-wrap items-center gap-1.5"><RefButton value={ref} pulls={pulls} onOpen={onOpenRef} />{ref.line === null && <span className="text-xs text-muted-foreground">tanpa nomor baris</span>}</span>{ref.line !== null && <RefSnippet value={ref} pulls={pulls} files={files} />}</li>)}</ul>
      : <p className="mt-1 inline-flex items-center gap-1 text-xs text-status-warn"><AlertCircle size={12} aria-hidden="true" />belum ada path:line</p>}
    <p className="mt-2.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Tes yang nutup</p>
    {line.tests.length
      ? <ul className="mt-1 flex flex-col gap-0.5">{line.tests.map((test) => <li key={test} className="flex items-center gap-1.5 font-mono text-[0.72rem] text-secondary-foreground"><FlaskConical size={11} aria-hidden="true" className="flex-none text-status-merged" />{test}</li>)}</ul>
      : <p className="mt-1 text-xs text-muted-foreground">{NOTHING_YET}</p>}
    <p className="mt-2.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Pull request</p>
    <p className="mt-1 flex flex-wrap gap-1.5">{line.prs.length ? line.prs.map((pr) => <span key={pr} className="inline-flex items-center gap-1 rounded-xs border border-border px-1.5 py-px font-mono text-[0.7rem]"><GitPullRequest size={11} aria-hidden="true" />{pr}</span>) : <span className="text-xs text-muted-foreground">{NOTHING_YET}</span>}</p>
    {line.note && <p className="mt-2 text-pretty text-xs text-muted-foreground">Catatan review: {line.note}</p>}
  </div>
);

/** Tiket → kode: every AC line of the ticket with its task, its pull request and the path:line that meets it. */
export const AcMap: React.FC<{ trace: AcTrace | null; loading: boolean; files: PullPatch[] | null; onOpenRef: (ref: AcRef) => void }> = ({ trace, loading, files, onOpenRef }) => {
  const [open, setOpen] = useState<number | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  if (!trace) return <p className="p-6 text-sm text-muted-foreground" role="status">{loading ? 'Loading Tiket → kode...' : `Tiket → kode ${NOTHING_YET}.`}</p>;
  const lines = onlyMissing ? missingOnly(trace.lines) : trace.lines;
  const full = trace.readable && trace.covered === trace.total;
  return (
    <div className="min-w-0 px-6 py-5 text-[0.82rem] leading-relaxed text-secondary-foreground max-[760px]:px-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Route size={15} aria-hidden="true" className="text-sky-200" /><b className="font-display text-foreground">Tiket → kode</b>
        {chip(trace.readable ? `${coverageText(trace)} baris AC punya kode` : NOTHING_YET, full)}
        {trace.readable && (
          <label className="ml-auto flex items-center gap-2 text-[0.72rem] text-muted-foreground max-[760px]:min-h-11"><Checkbox checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} />Cuma yang belum ada path:line · {missingOnly(trace.lines).length}</label>
        )}
      </div>
      {!trace.readable ? (
        <p className="rounded-sm border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Tiket → kode {NOTHING_YET}: blackboard tiket ini belum punya baris AC dengan path:line yang kebaca. Muncul begitu sous nulis file AC atau verdict review.</p>
      ) : (
        <>
          <div className="mb-2 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${trace.total},1fr)` }} aria-hidden="true">
            {trace.lines.map((line) => <i key={line.n} className={cn('h-1.5 rounded-pill', hasCode(line) ? 'bg-status-merged' : 'bg-status-warn-bg')} />)}
          </div>
          <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,.8fr)_minmax(0,1.2fr)] gap-2.5 border-b border-border pb-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.1em] text-muted-foreground max-[900px]:hidden">
            <span>Baris AC</span><span>Task</span><span>Kode (PR · path:line)</span>
          </div>
          {lines.length === 0 && <p className="py-3 text-sm text-muted-foreground">Semua baris AC udah punya path:line.</p>}
          {traceGroups(lines).map((group, index) => (
            <section key={`${group.group ?? ''}-${index}`} aria-label={group.group ?? 'AC'}>
              {group.group && <h3 className="pt-3 pb-1 font-mono text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground">{group.group}</h3>}
              {group.lines.map((line) => {
                const missing = !hasCode(line);
                return (
                  <React.Fragment key={line.n}>
                    <button type="button" aria-expanded={open === line.n} onClick={() => setOpen(open === line.n ? null : line.n)} className={cn('grid w-full grid-cols-[minmax(0,1.25fr)_minmax(0,.8fr)_minmax(0,1.2fr)] gap-2.5 border-0 border-b border-border bg-transparent py-2 text-left text-[0.8rem] max-[900px]:grid-cols-1 max-[760px]:min-h-11', missing && 'rounded-[6px] bg-status-warn-bg px-1.5')}>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          {line.state && <span className={cn('w-[46px] rounded-xs border py-0.5 text-center font-mono text-[0.62rem] font-extrabold', STATE_TONE[line.state])}>{line.state}</span>}
                          <b className="font-mono text-foreground">{line.label}</b>
                        </span>
                        <span className="line-clamp-2 text-pretty text-secondary-foreground">{line.text ?? NOTHING_YET}</span>
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5 text-foreground">
                        {line.tasks.length
                          ? line.tasks.map((task) => (
                            <span key={task.id} className="flex items-start gap-1.5">
                              {task.done ? <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 flex-none text-status-merged" /> : <CircleDashed size={13} aria-hidden="true" className="mt-0.5 flex-none text-status-warn" />}
                              <span className="min-w-0 truncate">{task.id}{task.title ? ` · ${task.title}` : ''}<span className="sr-only">{task.done ? ' selesai' : ' belum selesai'}</span></span>
                            </span>
                          ))
                          : <span className="text-muted-foreground">{NOTHING_YET}</span>}
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        {line.prs.length > 0 && <span className="flex flex-wrap gap-1">{line.prs.map((pr) => <span key={pr} className="rounded-xs border border-border px-1.5 py-px font-mono text-[0.66rem] text-secondary-foreground">{pr}</span>)}</span>}
                        {line.refs.slice(0, 3).map((ref) => <RefButton key={ref.text} value={ref} pulls={trace.pulls} onOpen={onOpenRef} />)}
                        {line.refs.length > 3 && <span className="font-mono text-[0.66rem] text-muted-foreground">+{line.refs.length - 3} lagi</span>}
                        {missing && <span className="inline-flex items-center gap-1 text-xs text-status-warn"><AlertCircle size={12} aria-hidden="true" />belum ada path:line</span>}
                      </span>
                    </button>
                    {open === line.n && <AcLineDetail line={line} pulls={trace.pulls} files={files} onOpenRef={onOpenRef} />}
                  </React.Fragment>
                );
              })}
            </section>
          ))}
        </>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Sumber: blackboard sous {trace.key}{trace.sources.length ? ` (${trace.sources.join(', ')})` : ''}. Dibaca ulang tiap blackboard berubah. Klik baris buat lihat semua path:line, tes, dan PR-nya.</p>
    </div>
  );
};
