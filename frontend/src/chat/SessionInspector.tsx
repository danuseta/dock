import React from 'react';
import { useQuery } from '@apollo/client';
import { ArrowRight, FileCode, FileDiff, Workflow } from 'lucide-react';
import type { AgentRun } from '../agents/runs';
import { changesHref } from '../changes/href';
import { GET_CHAT_SESSION, GET_ORCHESTRATION } from '../graphql/queries';
import { Badge, Button } from '../components/ui';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { TICKET_STEPS, stepIndex } from '../lib/ticketDetail';
import { CHAT_MACHINE_OPTIONS } from './composer/documents';
import { EMPTY_OPTIONS } from './composer/composerLogic';
import { changedFiles, filesTotal, stageLabel } from './headerState';
import { machineOf, sessionTurnOptions, type ChatSession } from './messages';
import { appliedOptions, type SessionMachineOptions } from './sessionOptions';
import type { ChatFileChange } from './status';

const SHOWN_FILES = 12;
const label = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

const SESSION_ROWS = ['effort', 'permissionMode'] as const;

interface SessionInspectorProps {
  session: Pick<ChatSession, 'id' | 'title' | 'ticketKey' | 'machine'>;
  /** The phone header has no room for the cost chip, so the sheet shows it. */
  costUsd?: number | null;
  files: readonly ChatFileChange[];
  onTicketClick?: (key: string) => void;
  onNavigate?: (path: string) => void;
  className?: string;
}

export const SessionInspector: React.FC<SessionInspectorProps> = ({ session, costUsd, files, onTicketClick, onNavigate, className }) => {
  const ticketKey = session.ticketKey || '';
  const { data: sessionData } = useQuery<{ chatSession: ChatSession | null }>(GET_CHAT_SESSION, { variables: { id: session.id } });
  const { data: machineData } = useQuery<{ chatMachineOptions: SessionMachineOptions | null }>(CHAT_MACHINE_OPTIONS, { variables: { machine: machineOf(session) } });
  const { data } = useQuery(GET_ORCHESTRATION, { ...CACHED_QUERY_OPTIONS, variables: { key: ticketKey }, skip: !ticketKey, pollInterval: 30000 });
  const run: AgentRun | null = ticketKey && data?.orchestration?.key?.toUpperCase() === ticketKey.toUpperCase() ? data.orchestration : null;
  const current = stepIndex(run?.stage);
  const machine = machineData?.chatMachineOptions ?? undefined;
  const options = sessionTurnOptions(sessionData?.chatSession) ?? EMPTY_OPTIONS;
  // A default the session's model cannot take (no effort levels, no Auto) is not shown as if it applied.
  const model = machine?.models.find((item) => item.value === (options.model ?? machine.defaults?.model));
  const autoBlocked = model?.auto === false && (options.permissionMode ?? machine?.defaults?.permissionMode) === 'auto';
  const applied = appliedOptions(options, machine).filter((row) => (row.field === 'effort' ? !model || model.efforts.length > 0 : !(row.field === 'permissionMode' && autoBlocked)));
  const sessionRows = SESSION_ROWS.flatMap((field) => applied.filter((row) => row.field === field));
  const changed = changedFiles(files);
  const total = filesTotal(changed);
  const changesRepo = run?.pullRequests?.[0]?.repo ?? run?.prBe ?? run?.prFe ?? null;
  return (
    <aside className={cn('flex min-h-0 flex-col gap-4 overflow-y-auto bg-surface-0 p-3.5', className)} aria-label="Session details">
      <section className={cn('flex flex-col gap-1.5', sessionRows.length === 0 && (costUsd != null ? 'min-[761px]:hidden' : 'hidden'))} aria-label="Session">
        <h3 className={label}>Session</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[0.72rem]">
          {sessionRows.map((row) => (
            <React.Fragment key={row.field}><dt className="text-muted-foreground">{row.label}</dt><dd className="min-w-0 truncate text-right text-secondary-foreground">{row.value}</dd></React.Fragment>
          ))}
          {costUsd != null && <><dt className="text-muted-foreground min-[761px]:hidden">Cost</dt><dd className="text-right tabular-nums text-secondary-foreground min-[761px]:hidden">${costUsd.toFixed(2)}</dd></>}
        </dl>
      </section>
      <section className="flex flex-col gap-2.5" aria-label="Ticket">
        <div className="flex items-center justify-between gap-2">
          <h3 className={label}>Ticket</h3>
          {ticketKey && <span className="rounded-xs border border-border-glow px-1.5 py-px font-mono text-[0.66rem] font-bold text-secondary-foreground">{ticketKey}</span>}
        </div>
        {!ticketKey && <p className="text-xs text-muted-foreground">This session has no ticket.</p>}
        {run && (
          <>
            <ol className="grid grid-cols-7 gap-0.5" aria-label="Agent stage">
              {TICKET_STEPS.map((step, index) => (
                <li key={step.id} title={step.name} aria-current={index === current ? 'step' : undefined} className={cn('h-1.5 rounded-pill', index === current ? 'bg-foreground' : index < current || run.finished ? 'bg-secondary-foreground/50' : 'bg-surface-2')}><span className="sr-only">{step.name}</span></li>
              ))}
            </ol>
            {current >= 0 && <p className="font-mono text-[0.72rem] text-secondary-foreground">{stageLabel(current)}</p>}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={run.acFailed > 0 ? 'danger' : 'neutral'}>AC {run.acPassed}/{run.acTotal}</Badge>
              {run.testsFe && <Badge title={`Tests FE: ${run.testsFe}`}>FE {run.testsFe.split(/[ ,]/)[0]}</Badge>}
              {run.testsBe && <Badge title={`Tests BE: ${run.testsBe}`}>BE {run.testsBe.split(/[ ,]/)[0]}</Badge>}
            </div>
          </>
        )}
        <div>
          <p className={cn(label, 'mb-1 flex items-center gap-2')}>
            <span>Files changed</span>
            {changed.length > 0 && <span className="font-mono normal-case tracking-normal tabular-nums"><span className="text-status-merged">+{total.added}</span> <span className="text-status-conflict">−{total.removed}</span></span>}
          </p>
          {changed.length === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> : (
            <ul className="flex flex-col gap-0.5 font-mono text-[0.7rem] text-secondary-foreground">
              {changed.slice(0, SHOWN_FILES).map((file) => (
                <li key={file.path} className="flex min-w-0 items-center gap-2" title={file.path}>
                  <FileCode size={12} aria-hidden="true" className="flex-none text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{baseName(file.path)}</span>
                  <span className="flex-none tabular-nums text-status-merged">+{file.added}</span>
                  <span className="flex-none tabular-nums text-status-conflict">−{file.removed}</span>
                </li>
              ))}
              {changed.length > SHOWN_FILES && <li className="text-muted-foreground">+{changed.length - SHOWN_FILES} more</li>}
            </ul>
          )}
        </div>
      </section>
      <div className="mt-auto flex flex-col gap-4">
        {ticketKey && onNavigate && run && <Button size="sm" variant="ghost" className="w-full max-[900px]:h-11" onClick={() => onNavigate(`/agents?run=${encodeURIComponent(ticketKey)}`)}><Workflow size={13} aria-hidden="true" />View flow</Button>}
        {ticketKey && onNavigate && changesRepo && <Button size="sm" variant="ghost" className="w-full max-[900px]:h-11" onClick={() => onNavigate(changesHref(ticketKey, changesRepo, 'sessions', session.id))}><FileDiff size={13} aria-hidden="true" />View changes</Button>}
        {ticketKey && onTicketClick && <Button size="sm" className="w-full max-[900px]:h-11" onClick={() => onTicketClick(ticketKey)}>Open ticket<ArrowRight size={13} aria-hidden="true" /></Button>}
      </div>
    </aside>
  );
};
