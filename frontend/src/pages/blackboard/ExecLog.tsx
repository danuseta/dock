import React, { useState } from 'react';
import { ScrollText } from 'lucide-react';
import type { AgentRun, AgentTimeline } from '../../agents/runs';
import { cn } from '../../lib/cn';
import { duration, execRows, filterExec, type ExecFilter } from '../../lib/execLog';

const FILTERS: Array<[ExecFilter, string]> = [['all', 'Semua'], ['fail', 'Gagal'], ['event', 'Event']];
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '–');
const cell = 'border-b border-border px-2 py-1.5 align-top';

/** Log eksekusi: one row per agent from its spawn to its stop, with the run's failures and events between them. */
export const ExecLog: React.FC<{ ticket: string; run: AgentRun | null; timeline: AgentTimeline | null }> = ({ ticket, run, timeline }) => {
  const [filter, setFilter] = useState<ExecFilter>('all');
  const all = execRows(run, timeline);
  const rows = filterExec(all, filter);
  return (
    <div className="bg-surface-0 px-4 pt-3 pb-2">
      <div className="rounded-sm border border-border px-3 py-2.5">
        <p className="mb-2 flex flex-wrap items-center gap-2 font-display text-sm font-bold text-foreground">
          <ScrollText size={14} aria-hidden="true" className="text-sky-200" />Log eksekusi {ticket}
          <span className="ml-auto inline-flex rounded-sm border border-border bg-surface-1 p-0.5 font-body" role="group" aria-label="Log eksekusi filter">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn('h-6 rounded-xs px-2.5 font-display text-[0.68rem] font-semibold text-secondary-foreground max-[760px]:h-11', filter === id && 'bg-accent text-black')}>{label} <span className="font-mono font-medium opacity-70">{filterExec(all, id).length}</span></button>
            ))}
          </span>
        </p>
        {all.length === 0
          ? <p className="text-sm text-muted-foreground">Log eksekusi belum ada: DOCK ini belum nerima event spawn/stop agent buat tiket ini.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[0.74rem]">
                <thead><tr>{['Mulai', 'Selesai', 'Agent', 'Mengerjakan', 'Hasil', 'Tool', 'Durasi'].map((name) => <th key={name} className="border-b border-border bg-surface-1 px-2 py-1.5 text-left font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">{name}</th>)}</tr></thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.at}-${index}`} className={cn(row.kind === 'fail' && 'bg-status-conflict-bg')}>
                      <td className={cn(cell, 'font-mono text-[0.7rem] whitespace-nowrap')}>{time(row.at)}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem] whitespace-nowrap')}>{row.kind === 'agent' ? time(row.until) : ''}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem] whitespace-nowrap', row.kind === 'fail' ? 'font-bold text-status-conflict' : row.kind === 'event' ? 'text-muted-foreground' : 'text-foreground')}>{row.agent}</td>
                      <td className={cn(cell, 'text-pretty text-secondary-foreground')}>{row.doing}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem]', row.kind === 'fail' && 'text-status-conflict')}>{row.result}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem] tabular-nums')}>{row.tools ?? ''}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem] tabular-nums')}>{row.kind === 'agent' ? duration(row.seconds) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <p className="mt-2 text-xs text-muted-foreground">Baris agent dari event spawn dan stop yang dikirim laptop atau workspace. Baris merah = gagal, baris abu = event run. Token per agent belum dicatat DOCK.</p>
      </div>
    </div>
  );
};
