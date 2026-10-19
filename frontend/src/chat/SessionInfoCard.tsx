import React from 'react';
import { useQuery } from '@apollo/client';
import { ArrowRight, FileCode } from 'lucide-react';
import type { AgentRun } from '../agents/runs';
import { GET_ORCHESTRATION } from '../graphql/queries';
import { Badge, Button, Card } from '../components/ui';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { TICKET_STEPS, stepIndex } from '../lib/ticketDetail';
import { LimitsLine } from './StatusLine';
import { machineOf, type ChatSession } from './messages';

const SHOWN_FILES = 8;
const label = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

interface SessionInfoCardProps {
  session: Pick<ChatSession, 'ticketKey' | 'machine'>;
  files: string[];
  onTicketClick?: (key: string) => void;
}

/** What the selected session works on: its ticket's stage and checks, the files it changed, and the machine's limits. */
export const SessionInfoCard: React.FC<SessionInfoCardProps> = ({ session, files, onTicketClick }) => {
  const ticketKey = session.ticketKey || '';
  const { data } = useQuery(GET_ORCHESTRATION, { ...CACHED_QUERY_OPTIONS, variables: { key: ticketKey }, skip: !ticketKey, pollInterval: 30000 });
  const run: AgentRun | null = ticketKey && data?.orchestration?.key?.toUpperCase() === ticketKey.toUpperCase() ? data.orchestration : null;
  const current = stepIndex(run?.stage);
  return (
    <Card className="flex min-h-0 flex-none flex-col gap-2.5 overflow-y-auto bg-surface-0 p-3 max-h-[45%]" aria-label="About this session">
      <div className="flex items-center justify-between gap-2">
        <span className={label}>This session</span>
        {ticketKey && <span className="rounded-xs border border-border-glow px-1.5 py-px font-mono text-[0.66rem] font-bold text-secondary-foreground">{ticketKey}</span>}
      </div>
      {run && (
        <>
          <ol className="grid grid-cols-7 gap-0.5" aria-label="Agent stage">
            {TICKET_STEPS.map((step, index) => (
              <li key={step.id} title={step.name} aria-current={index === current ? 'step' : undefined} className={cn('h-1.5 rounded-pill', index === current ? 'bg-foreground' : index < current || run.finished ? 'bg-secondary-foreground/50' : 'bg-surface-2')}><span className="sr-only">{step.name}</span></li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={run.acFailed > 0 ? 'danger' : 'neutral'}>AC {run.acPassed}/{run.acTotal}</Badge>
            {(run.pullRequests ?? []).map((pr) => <Badge key={pr.url}>{pr.repo}#{pr.number}</Badge>)}
            {run.testsFe && <Badge title={`Tests FE: ${run.testsFe}`}>FE {run.testsFe.split(/[ ,]/)[0]}</Badge>}
            {run.testsBe && <Badge title={`Tests BE: ${run.testsBe}`}>BE {run.testsBe.split(/[ ,]/)[0]}</Badge>}
          </div>
        </>
      )}
      <div>
        <p className={cn(label, 'mb-1')}>Files touched</p>
        {files.length === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> : (
          <ul className="flex flex-col gap-0.5 font-mono text-[0.7rem] text-secondary-foreground">
            {files.slice(0, SHOWN_FILES).map((file) => <li key={file} className="flex min-w-0 items-center gap-1.5" title={file}><FileCode size={11} className="flex-none text-muted-foreground" aria-hidden="true" /><span className="truncate">{baseName(file)}</span></li>)}
            {files.length > SHOWN_FILES && <li className="text-muted-foreground">+{files.length - SHOWN_FILES} more</li>}
          </ul>
        )}
      </div>
      <LimitsLine machine={machineOf(session)} />
      {ticketKey && onTicketClick && <Button size="sm" className="w-full max-[900px]:h-11" onClick={() => onTicketClick(ticketKey)}>Open ticket<ArrowRight size={13} aria-hidden="true" /></Button>}
    </Card>
  );
};
