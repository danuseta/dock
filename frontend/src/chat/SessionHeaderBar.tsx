import React from 'react';
import { ArrowLeft, PanelRight } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import { ModelPopover } from './ModelPopover';
import type { TurnOptionsControl } from './composer/useTurnOptions';
import type { DotState } from './headerState';
import { machineOf, sessionTitle, type ChatSession } from './messages';
import { formatTokens, type ChatSessionStatus } from './status';
import { ReadOnlyChip } from './SessionRow';
import { StatusDot } from './StatusDot';

interface SessionHeaderBarProps {
  session: ChatSession;
  dot: DotState;
  status?: ChatSessionStatus;
  control: TurnOptionsControl;
  inspectorOpen: boolean;
  lanes?: React.ReactNode;
  onBack: () => void;
  onToggleInspector: () => void;
}

export const SessionHeaderBar: React.FC<SessionHeaderBarProps> = ({ session, dot, status, control, inspectorOpen, lanes, onBack, onToggleInspector }) => {
  const readOnly = session.source === 'cli';
  const context = status?.contextPercentage != null ? Math.min(100, Math.max(0, status.contextPercentage)) : null;

  return (
    <div className="relative flex flex-none items-center gap-2 border-b border-border px-3.5 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 max-[760px]:gap-1.5">
      <Button size="sm" variant="ghost" className="hidden h-7 px-2 max-[900px]:inline-flex max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Back to the session list" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /></Button>
      <StatusDot state={dot} />
      <h2 className="min-w-24 flex-1 truncate font-display text-[0.95rem] font-bold max-[760px]:min-w-0" title={sessionTitle(session)}>{sessionTitle(session)}</h2>
      {readOnly && <ReadOnlyChip />}
      <ModelPopover control={control} machine={machineOf(session)} fallbackLabel={status?.model || 'Model'} disabled={readOnly} />
      {context !== null && (
        <span className="inline-flex h-7 flex-none items-center gap-1.5 rounded-xs border border-border px-2 font-mono text-[0.68rem] tabular-nums text-secondary-foreground" title="Context used">
          <span className="h-1.5 w-8 overflow-hidden max-[760px]:hidden rounded-pill bg-surface-2" role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(context)}><span className="block h-full bg-secondary-foreground" style={{ width: `${context}%` }} /></span>
          {status?.contextTokens != null && status.contextSize != null ? <>{formatTokens(status.contextTokens)}<span className="max-[760px]:hidden">/{formatTokens(status.contextSize)}</span></> : `${Math.round(context)}%`}
        </span>
      )}
      {status?.costUsd != null && <span className="inline-flex h-7 flex-none items-center rounded-xs border border-border px-2 font-mono text-[0.68rem] tabular-nums text-secondary-foreground max-[760px]:hidden" title="Cost of this session">${status.costUsd.toFixed(2)}</span>}
      {lanes}
      <Button size="sm" variant="ghost" className={cn('h-8 px-2 max-[900px]:h-11 max-[900px]:min-w-11', inspectorOpen && 'bg-surface-1 text-foreground')} aria-label={inspectorOpen ? 'Hide session details' : 'Show session details'} aria-pressed={inspectorOpen} title={inspectorOpen ? 'Hide details' : 'Show details'} onClick={onToggleInspector}><PanelRight size={14} aria-hidden="true" /></Button>
    </div>
  );
};
