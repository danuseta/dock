import React, { useState } from 'react';
import { ChevronDown, ChevronRight, User } from 'lucide-react';
import { cn } from '../lib/cn';
import { myTickets, type DraftFinding, type SprintDraft, type TicketSummaryLite } from './planning';

const chip = 'rounded-xs border px-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em]';

/** Planning > Draft > Tiket saya: the owner's tickets, each title and AC line with its Indonesian line under it. */
export const MyTicketsPanel: React.FC<{
  draft: Pick<SprintDraft, 'sprint' | 'tickets' | 'findings'>; me: string | null; summaries: Map<string, TicketSummaryLite>; onOpenTicket: (key: string) => void;
}> = ({ draft, me, summaries, onOpenTicket }) => {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const tickets = myTickets(draft, me);
  const findingsOf = (key: string, line: number): DraftFinding[] => draft.findings.filter((finding) => finding.key === key && finding.line === line);
  return (
    <section aria-label="Tiket saya" className="rounded-md border border-border bg-surface-1 px-3.5 py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-sm font-bold"><User size={14} className="text-sky-200" aria-hidden="true" />Tiket saya · {draft.sprint}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{me ? `${me} · ${tickets.length} tiket` : 'Nama Jira kamu belum kebaca'}</span>
      </div>
      {tickets.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{me ? 'Belum ada tiket kamu di draft ini.' : 'Tiket kamu muncul begitu nama Jira kebaca dari token di Settings.'}</p>
      ) : tickets.map((ticket) => {
        const summary = summaries.get(ticket.key);
        const shown = !!open[ticket.key];
        return (
          <div key={ticket.key} className="border-t border-border py-2 first-of-type:border-t-0">
            <div className="flex items-start gap-2 text-[0.8rem]">
              <button type="button" aria-expanded={shown} aria-label={`${shown ? 'Tutup' : 'Buka'} AC ${ticket.key}`} onClick={() => setOpen((current) => ({ ...current, [ticket.key]: !shown }))} className="grid size-7 flex-none place-items-center rounded-sm text-muted-foreground hover:bg-surface-2 max-[760px]:size-11">
                {shown ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
              </button>
              <button type="button" className="mt-1 font-mono font-bold text-accent hover:underline" onClick={() => onOpenTicket(ticket.key)}>{ticket.key}</button>
              <span className="mt-1 flex min-w-0 flex-1 flex-col">
                <span className="text-pretty text-foreground">{ticket.summary}</span>
                {summary?.titleId ? <span className="text-pretty text-xs text-muted-foreground">{summary.titleId}</span> : !summary && <span className="text-xs text-muted-foreground">belum ada ringkasan</span>}
              </span>
              <span className="mt-1 flex-none font-mono text-[0.66rem] text-muted-foreground">{ticket.ac.length} AC</span>
              <span className="mt-1 flex-none rounded-xs bg-sky-300/10 px-1.5 py-0.5 font-mono text-[0.66rem] font-semibold whitespace-nowrap text-sky-200">{ticket.status}</span>
            </div>
            {shown && (
              <ol className="mt-1 mb-1 ml-9 rounded-sm border border-border bg-surface-0 px-3 py-1.5">
                {ticket.ac.length === 0 && <li className="py-1.5 text-sm text-muted-foreground">AC belum diisi.</li>}
                {ticket.ac.map((line, index) => {
                  const refs = findingsOf(ticket.key, index + 1);
                  return (
                    <li key={index} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 border-t border-border py-2 first:border-t-0">
                      <span className="pt-0.5 font-mono text-[0.68rem] font-bold text-muted-foreground">{index + 1}</span>
                      <div className="min-w-0">
                        <p className="text-pretty text-[0.82rem] text-foreground">{line}</p>
                        {summary?.acId[index] && <p className="mt-0.5 text-pretty text-[0.78rem] text-muted-foreground">{summary.acId[index]}</p>}
                        {refs.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {refs.map((finding) => {
                              const action = finding.decision?.action;
                              const label = finding.linked || action === 'dependency' || action === 'wait' ? 'dependency' : action === 'reference' || action === 'drop' ? 'pindah ke Reference' : action === 'move' ? 'pindah tiket' : 'belum diputusin';
                              return <span key={finding.id} className={cn(chip, label === 'dependency' || label === 'belum diputusin' ? 'border-status-warn text-status-warn' : 'border-border text-muted-foreground')}>{finding.refKey} · {label}</span>;
                            })}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </section>
  );
};
