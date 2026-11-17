import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Undo2 } from 'lucide-react';
import { GUILD_MASTER_ROLLBACK } from '../graphql/mutations';
import { GET_GUILD_MASTER_LOG } from '../graphql/queries';
import { Badge, ConfirmDialog } from '../components/ui';
import { cn } from '../lib/cn';

export interface GuildMasterLogEntry {
  id: number;
  at: string;
  by: string;
  sessionId: string | null;
  kind: 'change' | 'rollback' | string;
  target: string;
  summary: string;
  diff: string;
  backup: string;
  rollbackOf: number | null;
  rolledBack: boolean;
}

const label = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const when = (at: string) => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * The right column of a Guild Master session: the change a plain "ya" would write, exactly as DOCK will confirm it, and the manager log
 * every Guild Master session shares, with one-click rollback.
 */
export const GuildMasterPanel: React.FC<{ className?: string; proposal?: { summary: string; diff: string; at: string } | null }> = ({ className, proposal }) => {
  const { data, loading, error, refetch } = useQuery<{ guildMasterLog: GuildMasterLogEntry[] }>(GET_GUILD_MASTER_LOG, { fetchPolicy: 'cache-and-network', pollInterval: 30000 });
  const [rollback, { loading: rolling }] = useMutation(GUILD_MASTER_ROLLBACK);
  const [target, setTarget] = useState<GuildMasterLogEntry | null>(null);
  const [actionError, setActionError] = useState('');
  const entries = data?.guildMasterLog ?? [];

  const confirmRollback = async () => {
    if (!target) return;
    setActionError('');
    try {
      await rollback({ variables: { id: target.id } });
      await refetch();
    } catch (rollbackError) {
      setActionError(rollbackError instanceof Error ? rollbackError.message : 'The rollback failed');
    } finally {
      setTarget(null);
    }
  };

  return (
    <aside className={cn('flex min-h-0 flex-col gap-4 overflow-y-auto bg-surface-0 p-3.5', className)} aria-label="Guild Master">
      <div>
        <p className={label}>Waiting for your ya</p>
        {proposal ? (
          <div className="mt-1 rounded-sm border border-status-warn/40 bg-status-warn-bg p-2">
            <p className="text-[0.78rem] text-foreground">{proposal.summary}</p>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.66rem] text-secondary-foreground">{proposal.diff}</pre>
            <p className="mt-1 text-[0.68rem] text-muted-foreground">Answer ya as your next message to write exactly this. Anything else drops it.</p>
          </div>
        ) : <p className="mt-1 text-xs text-muted-foreground">Nothing is waiting.</p>}
      </div>
      <div>
        <p className={label}>Manager log <span className="normal-case tracking-normal">· all Guild Master sessions</span></p>
        {error && <p className="mt-2 text-pretty text-xs text-status-conflict" role="alert">The manager log could not be read: {error.message}</p>}
        {actionError && <p className="mt-2 text-pretty text-xs text-status-conflict" role="alert">{actionError}</p>}
        {!error && !loading && entries.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No change written yet.</p>}
        <ul className="mt-1 flex flex-col">
          {entries.map((entry) => (
            <li key={entry.id} className="border-b border-border py-2 last:border-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[0.66rem] text-muted-foreground">#{entry.id} · {when(entry.at)}</span>
                {entry.kind === 'rollback' ? <Badge>rollback of #{entry.rollbackOf}</Badge> : <Badge variant={entry.rolledBack ? 'neutral' : 'success'}>{entry.rolledBack ? 'rolled back' : 'applied'}</Badge>}
                {!entry.rolledBack && entry.backup && (
                  <button type="button" className="ml-auto inline-flex items-center gap-1 text-[0.7rem] font-semibold text-accent hover:underline max-[900px]:min-h-11" disabled={rolling} onClick={() => setTarget(entry)}>
                    <Undo2 size={12} aria-hidden="true" />Rollback
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-[0.78rem] text-foreground">{entry.summary}</p>
              <p className="font-mono text-[0.62rem] text-muted-foreground">{entry.target} · {entry.by}{entry.backup ? ` · ${entry.backup}` : ''}</p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className={label}>Guild Master never</p>
        <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4 text-[0.74rem] text-secondary-foreground">
          <li>writes code, runs tests or opens worktrees</li>
          <li>pushes, merges or approves; moves Jira; posts to Discord</li>
          <li>reads secrets or raw ticket, PR or Discord text</li>
          <li>dispatches agents or starts sous</li>
          <li>writes anything before you answer ya in the chat</li>
        </ul>
      </div>
      <ConfirmDialog
        open={Boolean(target)}
        title={`Roll back #${target?.id ?? ''}?`}
        description={target ? `${target.target} goes back to the backup ${target.backup}. The rollback is logged too.` : ''}
        confirmLabel="Roll back"
        busyLabel="Rolling back..."
        busy={rolling}
        onConfirm={() => void confirmRollback()}
        onCancel={() => setTarget(null)}
      />
    </aside>
  );
};
