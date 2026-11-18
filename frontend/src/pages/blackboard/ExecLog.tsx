import React, { useState } from 'react';
import { ScrollText } from 'lucide-react';
import type { AgentRun, AgentTimeline } from '../../agents/runs';
import { cn } from '../../lib/cn';
import { dayKey, dayLabel, stamp } from '../../lib/logDays';
import { duration, execRows, filterExec, type ExecFilter } from '../../lib/execLog';
import { CCUSAGE_MISSING, formatCost, formatTokens, type ClaudeTicketUsage } from '../../lib/claudeUsage';

const FILTERS: Array<[ExecFilter, string]> = [['all', 'All'], ['fail', 'Failed'], ['event', 'Event']];
const COLUMNS = ['Start', 'End', 'Agent', 'Doing', 'Result', 'Tools', 'Duration', 'Tokens · peak', 'Cost'];
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '–');
const cell = 'border-b border-border px-2 py-1.5 align-top';

/** Log eksekusi: one row per agent from its spawn to its stop, with the run's failures and events between them. */
export const ExecLog: React.FC<{ ticket: string; run: AgentRun | null; timeline: AgentTimeline | null; usage?: ClaudeTicketUsage | null }> = ({ ticket, run, timeline, usage }) => {
  const [filter, setFilter] = useState<ExecFilter>('all');
  const all = execRows(run, timeline);
  const rows = filterExec(all, filter);
  const counted = usage?.available ? usage : null;
  const byAgent = new Map((counted?.agents ?? []).map((agent) => [agent.agentId, agent]));
  return (
    <div className="bg-surface-0 px-4 pt-3 pb-2">
      <div className="rounded-sm border border-border px-3 py-2.5">
        <p className="mb-2 flex flex-wrap items-center gap-2 font-display text-sm font-bold text-foreground">
          <ScrollText size={14} aria-hidden="true" className="text-sky-200" />Execution log {ticket}
          <span className="ml-auto inline-flex rounded-sm border border-border bg-surface-1 p-0.5 font-body" role="group" aria-label="Execution log filter">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn('h-6 rounded-xs px-2.5 font-display text-[0.68rem] font-semibold text-secondary-foreground max-[760px]:h-11', filter === id && 'bg-accent text-black')}>{label} <span className="font-mono font-medium opacity-70">{filterExec(all, id).length}</span></button>
            ))}
          </span>
        </p>
        {all.length === 0
          ? <p className="text-sm text-muted-foreground">No execution log yet: this DOCK has not received agent spawn/stop events for this ticket.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-[0.74rem]">
                <thead><tr>{COLUMNS.map((name) => <th key={name} className="border-b border-border bg-surface-1 px-2 py-1.5 text-left font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">{name}</th>)}</tr></thead>
                <tbody>
                  {rows.map((row, index) => (
                    <React.Fragment key={`${row.at}-${index}`}>
                    {(index === 0 || dayKey(rows[index - 1].at) !== dayKey(row.at)) && <tr><th colSpan={COLUMNS.length} scope="colgroup" className="border-b border-border bg-surface-0 px-2 pt-2.5 pb-1 text-left font-mono text-[0.6rem] font-bold tracking-[0.1em] text-muted-foreground">{dayLabel(row.at)}</th></tr>}
                    <tr className={cn(row.kind === 'fail' && 'bg-status-conflict-bg')}>
                      <td title={stamp(row.at)} className={cn(cell, 'font-mono text-[0.7rem] whitespace-nowrap')}>{time(row.at)}</td>
                      <td title={row.kind === 'agent' && row.until ? stamp(row.until) : undefined} className={cn(cell, 'font-mono text-[0.7rem] whitespace-nowrap')}>{row.kind === 'agent' ? time(row.until) : ''}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem] whitespace-nowrap', row.kind === 'fail' ? 'font-bold text-status-conflict' : row.kind === 'event' ? 'text-muted-foreground' : 'text-foreground')}>{row.agent}</td>
                      <td className={cn(cell, 'text-pretty text-secondary-foreground')}>{row.doing}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem]', row.kind === 'fail' && 'text-status-conflict')}>{row.result}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem] tabular-nums')}>{row.tools ?? ''}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem] tabular-nums')}>{row.kind === 'agent' ? duration(row.seconds) : ''}</td>
                      <td className={cn(cell, 'whitespace-nowrap font-mono text-[0.7rem] tabular-nums')}>{row.kind !== 'agent' ? '' : !counted ? '-' : row.id && byAgent.get(row.id) ? <>{formatTokens(byAgent.get(row.id)?.totalTokens ?? 0)}<span className="block text-[0.64rem] text-muted-foreground">peak {formatTokens(byAgent.get(row.id)?.peakContext ?? 0)}</span></> : ''}</td>
                      <td className={cn(cell, 'font-mono text-[0.7rem] tabular-nums')}>{row.kind !== 'agent' ? '' : !counted ? '-' : row.id && byAgent.get(row.id) ? formatCost(byAgent.get(row.id)?.cost ?? 0) : ''}</td>
                    </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {usage && (
          <p className="mt-2 font-mono text-[0.7rem] text-secondary-foreground">
            Ticket total: {counted ? <><b className="text-foreground">{formatTokens(counted.totalTokens)} tokens</b> · <b className="text-foreground">{formatCost(counted.totalCost)}</b> <span className="text-muted-foreground">({counted.sessions} {counted.sessions === 1 ? 'session' : 'sessions'}, subagents included)</span></> : <>- <span className="font-body text-muted-foreground">{usage.error ? `ccusage failed: ${usage.error}` : CCUSAGE_MISSING}</span></>}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Agent rows come from spawn and stop events sent by the laptop or workspace. Red rows = failed, grey rows = run events. Tokens and cost come from ccusage; the cost of one agent is an estimate, the session cost split by token weight per model.</p>
      </div>
    </div>
  );
};
