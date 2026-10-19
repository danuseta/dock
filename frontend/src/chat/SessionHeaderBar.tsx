import React, { useState } from 'react';
import { useMutation } from '@apollo/client';
import { ArrowLeft, Info, Pencil, Trash2 } from 'lucide-react';
import { RENAME_CHAT_SESSION } from '../graphql/mutations';
import { Button, Input } from '../components/ui';
import { cn } from '../lib/cn';
import { ModelPopover } from './ModelPopover';
import type { TurnOptionsControl } from './composer/useTurnOptions';
import { DOT_LABEL, type DotState } from './headerState';
import { machineOf, sessionTitle, type ChatSession } from './messages';
import { formatTokens, type ChatSessionStatus } from './status';
import { ReadOnlyChip } from './SessionRow';

const TITLE_MAX = 120;

const DOT_CLASS: Record<DotState, string> = {
  running: 'bg-status-merged',
  needs: 'bg-amber-300',
  delayed: 'border-2 border-amber-300',
  disconnected: 'bg-status-conflict',
  done: 'bg-muted-foreground',
};

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export const StatusDot: React.FC<{ state: DotState }> = ({ state }) => (
  <span className="inline-flex flex-none" role="img" aria-label={DOT_LABEL[state]} title={DOT_LABEL[state]}>
    <i className={cn('size-2.5 rounded-full', DOT_CLASS[state])} aria-hidden="true" />
  </span>
);

interface SessionHeaderBarProps {
  session: ChatSession;
  dot: DotState;
  status?: ChatSessionStatus;
  delayed: boolean;
  control: TurnOptionsControl;
  inspectorOpen: boolean;
  lanes?: React.ReactNode;
  onBack: () => void;
  onDelete: () => void;
  onToggleInspector: () => void;
}

export const SessionHeaderBar: React.FC<SessionHeaderBarProps> = ({ session, dot, status, delayed, control, inspectorOpen, lanes, onBack, onDelete, onToggleInspector }) => {
  const [rename, { loading: renaming }] = useMutation(RENAME_CHAT_SESSION);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const readOnly = session.source === 'cli';
  const dim = delayed ? 'opacity-50' : '';
  const context = status?.contextPercentage != null ? Math.min(100, Math.max(0, status.contextPercentage)) : null;

  const saveTitle = async () => {
    const title = (titleDraft ?? '').trim();
    if (!title) return;
    setError('');
    try {
      await rename({ variables: { id: session.id, title } });
      setTitleDraft(null);
    } catch (renameError) {
      setError(messageOf(renameError, 'The session could not be renamed'));
    }
  };

  return (
    <div className="flex flex-none flex-col border-b border-border">
      <div className="flex flex-wrap items-center gap-2 max-[760px]:flex-nowrap max-[760px]:gap-1.5 px-3.5 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
        <Button size="sm" variant="ghost" className="hidden h-7 px-2 max-[900px]:inline-flex max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Back to the session list" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /></Button>
        <StatusDot state={dot} />
        {titleDraft === null ? (
          <h2 className="min-w-0 flex-1 truncate font-display text-[0.95rem] font-bold max-[900px]:basis-0" title={sessionTitle(session)}>{sessionTitle(session)}</h2>
        ) : (
          <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
            <Input className="h-8 min-w-0 flex-1 px-2.5 text-[0.82rem] max-[900px]:h-11" value={titleDraft} maxLength={TITLE_MAX} aria-label="Session title" autoFocus onChange={(event) => setTitleDraft(event.target.value)} />
            <Button size="sm" type="submit" variant="primary" className="max-[900px]:h-11" disabled={renaming || !titleDraft.trim()}>Save</Button>
            <Button size="sm" variant="ghost" className="max-[900px]:h-11" onClick={() => setTitleDraft(null)}>Cancel</Button>
          </form>
        )}
        {titleDraft === null && (
          <>
            {readOnly && <ReadOnlyChip />}
            <ModelPopover control={control} machine={machineOf(session)} fallbackLabel={status?.model || 'Model'} disabled={readOnly} dimmed={delayed} />
            {context !== null && (
              <span className={cn('inline-flex h-7 flex-none items-center gap-1.5 rounded-xs border border-border px-2 font-mono text-[0.68rem] tabular-nums text-secondary-foreground', dim)} title="Context used">
                <span className="h-1.5 w-8 overflow-hidden max-[760px]:hidden rounded-pill bg-surface-2" role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(context)}><span className="block h-full bg-secondary-foreground" style={{ width: `${context}%` }} /></span>
                {status?.contextTokens != null && status.contextSize != null ? <>{formatTokens(status.contextTokens)}<span className="max-[760px]:hidden">/{formatTokens(status.contextSize)}</span></> : `${Math.round(context)}%`}
              </span>
            )}
            {status?.costUsd != null && <span className={cn('inline-flex h-7 flex-none items-center rounded-xs border border-border px-2 font-mono text-[0.68rem] tabular-nums text-secondary-foreground max-[760px]:hidden', dim)} title="Cost of this session">${status.costUsd.toFixed(2)}</span>}
            {lanes}
            <Button size="sm" variant="ghost" className="h-8 px-2 max-[760px]:hidden max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Rename session" title="Rename" onClick={() => setTitleDraft(session.title)}><Pencil size={13} aria-hidden="true" /></Button>
            <Button size="sm" variant="ghost" className="h-8 px-2 max-[760px]:hidden max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Delete session" title="Delete" onClick={onDelete}><Trash2 size={13} aria-hidden="true" /></Button>
            <Button size="sm" variant="ghost" className={cn('h-8 px-2 max-[900px]:h-11 max-[900px]:min-w-11', inspectorOpen && 'bg-surface-1 text-foreground')} aria-label="Session details" aria-pressed={inspectorOpen} title="Details" onClick={onToggleInspector}><Info size={13} aria-hidden="true" /></Button>
          </>
        )}
      </div>
      {error && <p className="border-t border-border px-3.5 py-1.5 text-pretty text-xs break-words text-status-conflict" role="alert">{error}</p>}
    </div>
  );
};
