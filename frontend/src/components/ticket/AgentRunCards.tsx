import React from 'react';
import { Bot, ListChecks, MessagesSquare } from 'lucide-react';
import { stageLabel, type AgentRun } from '../../agents/runs';
import { machineOf, machinePlace } from '../../chat/messages';
import { LimitsLine } from '../../chat/StatusLine';
import { cn } from '../../lib/cn';
import { Badge, Button, Card } from '../ui';

const acTone = (state: string) => state === 'PASS'
  ? 'border-status-merged bg-status-merged-bg text-status-merged'
  : state === 'FAIL'
    ? 'border-status-conflict bg-status-conflict-bg text-status-conflict'
    : 'border-border-glow text-secondary-foreground';

/** The acceptance criteria the run checks, each with the evidence the agent recorded. */
export const AcceptanceCard: React.FC<{ run?: AgentRun | null }> = ({ run }) => {
  const ac = run?.ac ?? [];
  return (
    <Card id="acceptance-criteria" className="scroll-mt-6">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold"><ListChecks size={19} className="text-accent" aria-hidden="true" />Acceptance criteria</h2>
        {run && <Badge variant={run.acFailed > 0 ? 'danger' : run.acTotal > 0 && run.acPassed === run.acTotal ? 'success' : 'neutral'}>{run.acPassed}/{run.acTotal}</Badge>}
      </div>
      {ac.length === 0 ? (
        <p className="py-2 text-pretty text-sm text-muted-foreground">{run ? 'No acceptance criteria recorded yet.' : 'They show here once an agent run starts on this ticket.'}</p>
      ) : (
        <ol className="flex flex-col">
          {ac.map((item) => (
            <li className="grid grid-cols-[46px_1fr] gap-2.5 border-b border-border py-2 text-sm last:border-b-0" key={item.n}>
              <span className={cn('h-fit rounded-xs border py-0.5 text-center font-mono text-[0.62rem] font-extrabold', acTone(item.state))}>{item.state}</span>
              <span className="min-w-0 text-pretty">
                {item.text || `AC ${item.n}`}
                {item.evidence && <span className="mt-0.5 block break-words font-mono text-[0.7rem] text-muted-foreground">{item.evidence}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
};

/** Where the run is and how much room it has, with the way into its session. */
export const AgentRunCard: React.FC<{ run?: AgentRun | null; opening: boolean; onSession: () => void }> = ({ run, opening, onSession }) => (
  <Card>
    <div className="mb-3 flex items-center justify-between gap-2 border-b border-border pb-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold"><Bot size={19} className="text-accent" aria-hidden="true" />Agent run</h2>
      {run && <Badge className="uppercase">{stageLabel(run.stage)}</Badge>}
    </div>
    {run ? (
      <div className="flex flex-col gap-2.5 text-sm">
        <p className="text-pretty text-xs text-muted-foreground">Runs on {machineOf(run) === 'workspace' ? 'the Coder workspace' : machinePlace(machineOf(run))}{run.remote ? ', reported by the other DOCK. Read-only here.' : '.'}</p>
        {run.activity && <p className="text-pretty text-secondary-foreground">{run.activity}</p>}
        {(run.testsBe || run.testsFe) && (
          <dl className="grid grid-cols-[72px_1fr] gap-x-2.5 gap-y-1 text-[0.82rem]">
            {run.testsBe && <><dt className="font-mono text-[0.68rem] font-semibold text-muted-foreground">Tests BE</dt><dd className="break-words">{run.testsBe}</dd></>}
            {run.testsFe && <><dt className="font-mono text-[0.68rem] font-semibold text-muted-foreground">Tests FE</dt><dd className="break-words">{run.testsFe}</dd></>}
          </dl>
        )}
        <LimitsLine machine={machineOf(run)} />
      </div>
    ) : <p className="text-pretty text-sm text-muted-foreground">No agent run on this ticket.</p>}
    <Button className="mt-3 w-full max-[760px]:h-11" onClick={onSession} disabled={opening}><MessagesSquare size={15} aria-hidden="true" />{opening ? 'Opening...' : 'Open session'}</Button>
  </Card>
);
