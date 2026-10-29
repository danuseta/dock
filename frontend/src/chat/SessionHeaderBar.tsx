import React, { useEffect, useState } from 'react';
import { ArrowLeft, PanelRight, Pencil, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import { ModelOptions, ModelPopover } from './ModelPopover';
import type { TurnOptionsControl } from './composer/useTurnOptions';
import { modelSummary, type DotState } from './headerState';
import { machineOf, sessionTitle, type ChatSession } from './messages';
import { formatTokens, type ChatSessionStatus } from './status';
import { ReadOnlyChip } from './SessionRow';
import { StatusDot } from './StatusDot';
import { useMakeDefault } from './useMakeDefault';

interface SessionHeaderBarProps {
  session: ChatSession;
  dot: DotState;
  status?: ChatSessionStatus;
  control: TurnOptionsControl;
  inspectorOpen: boolean;
  lanes?: React.ReactNode;
  onBack: () => void;
  onToggleInspector: () => void;
  onRename: () => void;
}

export const SessionHeaderBar: React.FC<SessionHeaderBarProps> = ({ session, dot, status, control, inspectorOpen, lanes, onBack, onToggleInspector, onRename }) => {
  const [drawer, setDrawer] = useState(false);
  const readOnly = session.source === 'cli';
  const context = status?.contextPercentage != null ? Math.min(100, Math.max(0, status.contextPercentage)) : null;
  const { machineOptions, rows, label } = modelSummary(control, status?.model || 'Model');
  const makeDefault = useMakeDefault(machineOf(session), rows);
  const bypass = rows.find((row) => row.field === 'permissionMode')?.value === 'bypassPermissions';
  const contextText = context === null ? '' : status?.contextTokens != null ? formatTokens(status.contextTokens) : `${Math.round(context)}%`;
  const options = machineOptions !== undefined && !readOnly ? machineOptions : null;

  useEffect(() => {
    if (!drawer) return undefined;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [drawer]);

  return (
    <div className="relative flex flex-none items-center gap-2 border-b border-border px-3.5 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 max-[760px]:gap-1.5">
      <Button size="sm" variant="ghost" className="hidden h-7 px-2 max-[900px]:inline-flex max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Back to the session list" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /></Button>
      <StatusDot state={dot} />
      <div className="flex min-w-24 flex-1 flex-col max-[760px]:min-w-0">
        <h2 className="truncate font-display text-[0.95rem] font-bold max-[760px]:overflow-visible max-[760px]:whitespace-normal max-[760px]:break-words max-[760px]:text-base" title={sessionTitle(session)}>{sessionTitle(session)}</h2>
        <p className="hidden items-center gap-1.5 whitespace-nowrap font-mono text-xs text-secondary-foreground max-[760px]:flex">
          {bypass && <span className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-bold uppercase text-status-conflict">Bypass</span>}
          <span className="min-w-0 truncate">{label}{contextText && ` · ${contextText}`}</span>
        </p>
      </div>
      {readOnly && <ReadOnlyChip />}
      <div className="contents max-[760px]:hidden">
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
      <Button size="sm" variant="ghost" className="hidden h-11 min-w-11 max-[760px]:inline-flex" aria-label="Model, effort and mode" aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)}><SlidersHorizontal size={18} aria-hidden="true" /></Button>
      {drawer && (
        <div className="fixed inset-0 z-[56] min-[761px]:hidden">
          <button type="button" className="absolute inset-0 bg-black/50" aria-hidden="true" tabIndex={-1} onClick={() => setDrawer(false)} />
          <div role="dialog" aria-label="Model, effort and mode" className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col gap-2.5 overflow-y-auto rounded-t-lg border-t border-border-glow bg-surface-1 p-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-card">
            <div className="flex items-center justify-between"><span className="mx-auto h-1.5 w-10 rounded-pill bg-border-glow" aria-hidden="true" /><Button size="sm" variant="ghost" className="h-11 min-w-11" aria-label="Close" onClick={() => setDrawer(false)}><X size={15} aria-hidden="true" /></Button></div>
            {options && <ModelOptions control={control} rows={rows} machineOptions={options} makeDefault={makeDefault} />}
            {context !== null && <div className="flex min-h-11 items-center justify-between font-mono text-sm tabular-nums"><span className="text-muted-foreground">Context</span><span>{contextText}{status?.contextSize != null && `/${formatTokens(status.contextSize)}`}</span></div>}
            <button type="button" className="flex min-h-11 items-center gap-2.5 border-t border-border text-left text-[0.95rem]" onClick={() => { setDrawer(false); if (!inspectorOpen) onToggleInspector(); }}><PanelRight size={18} aria-hidden="true" />Session details</button>
            {session.source === 'dock' && <button type="button" className="flex min-h-11 items-center gap-2.5 text-left text-[0.95rem]" onClick={() => { setDrawer(false); onRename(); }}><Pencil size={18} aria-hidden="true" />Rename session</button>}
          </div>
        </div>
      )}
    </div>
  );
};
