import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowRightLeft, CheckCircle2, Circle, Info, RefreshCw, Users } from 'lucide-react';
import { GET_CLAUDE_ACCOUNTS } from '../graphql/queries';
import { SET_CLAUDE_ROTATION, USE_CLAUDE_ACCOUNT } from '../graphql/mutations';
import { limitTone, toneClass } from '../chat/status';
import { useNow } from '../chat/activity/useNow';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { Button, Card, Checkbox, Input } from './ui';

interface UsageWindow { usedPercentage: number; resetsAt: string | null }
interface Account { name: string; active: boolean; seenAt: string | null; fiveHour: UsageWindow | null; sevenDay: UsageWindow | null }
interface Rotation { enabled: boolean; fiveHour: number; sevenDay: number; backToMain: boolean }
interface Entry { at: string; from: string; to: string; reason: string; auto: boolean }
interface State { available: boolean; accounts: Account[]; rotation: Rotation; log: Entry[] }

const METER = { ok: 'bg-status-merged', warn: 'bg-amber-200', danger: 'bg-status-conflict' } as const;
/** When a window resets: the time today, the day and time later. */
const resetAt = (iso: string, now: number) => {
  const at = new Date(iso);
  const clock = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return at.getTime() - now < 20 * 3_600_000 ? clock : `${at.toLocaleDateString([], { weekday: 'short' })} ${clock}`;
};
const time = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const Meter: React.FC<{ label: string; window: UsageWindow | null; now: number }> = ({ label, window, now }) => {
  if (!window) return <span className="font-mono text-[0.7rem] text-muted-foreground">{label} -</span>;
  const used = Math.min(100, Math.max(0, Math.round(window.usedPercentage)));
  const tone = limitTone(used);
  return (
    <span className="grid min-w-0 gap-1 font-mono text-[0.7rem]">
      <span className="flex justify-between gap-2 whitespace-nowrap"><span className={toneClass[tone]}>{label} {used}%</span><span className="truncate text-muted-foreground">{window.resetsAt ? resetAt(window.resetsAt, now) : ''}</span></span>
      <span className="h-1.5 overflow-hidden rounded-pill bg-surface-2" role="meter" aria-label={`${label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}><span className={cn('block h-full', METER[tone])} style={{ width: `${used}%` }} /></span>
    </span>
  );
};

/** The Claude accounts of `/cycle` on this workspace: switch by hand, and the limits auto rotate moves on. */
export const ClaudeAccountSection: React.FC = () => {
  const { data, error, loading } = useQuery<{ claudeAccounts: State }>(GET_CLAUDE_ACCOUNTS, { ...CACHED_QUERY_OPTIONS, pollInterval: 60000 });
  const [switchAccount, { loading: switching }] = useMutation(USE_CLAUDE_ACCOUNT, { refetchQueries: [GET_CLAUDE_ACCOUNTS] });
  const [setRotation, { loading: saving }] = useMutation(SET_CLAUDE_ROTATION, { refetchQueries: [GET_CLAUDE_ACCOUNTS] });
  const [actionError, setActionError] = useState('');
  const [limits, setLimits] = useState({ fiveHour: '', sevenDay: '' });
  const state = data?.claudeAccounts;
  const rotation = state?.rotation;
  const now = useNow(false);

  useEffect(() => {
    if (rotation) setLimits({ fiveHour: String(rotation.fiveHour), sevenDay: String(rotation.sevenDay) });
  }, [rotation]);

  const run = async (action: () => Promise<unknown>) => {
    setActionError('');
    try { await action(); } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'It did not go through'); }
  };
  const saveRotation = (change: Partial<Rotation>) => rotation && run(() => setRotation({ variables: { ...rotation, ...change } }));
  const savePercent = (key: 'fiveHour' | 'sevenDay') => {
    const value = Number(limits[key]);
    if (!rotation || value === rotation[key]) return;
    if (!Number.isInteger(value) || value < 50 || value > 100) {
      setActionError('A limit is a whole percentage from 50 to 100.');
      setLimits((current) => ({ ...current, [key]: String(rotation[key]) }));
      return;
    }
    void saveRotation({ [key]: value });
  };

  if (error && !data) return <Card className="border-status-conflict text-sm text-status-conflict" role="alert">{error.message}</Card>;
  if (!state) return <Card className="text-sm text-muted-foreground" role="status">{loading ? 'Loading accounts...' : ''}</Card>;
  if (!state.available) {
    return <Card className="text-sm text-muted-foreground">This machine has no <code className="font-mono">/cycle</code>. It comes with the workspace template; add accounts there with the Coder parameters.</Card>;
  }

  return (
    <div className="flex flex-col gap-5">
      {actionError && <p className="text-xs text-status-conflict" role="alert">{actionError}</p>}
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-8 flex-none place-items-center rounded-sm bg-surface-2 text-secondary-foreground"><Users size={16} aria-hidden="true" /></span>
          <div><h3 className="font-display text-base font-bold">Accounts</h3><p className="text-xs text-muted-foreground">A switch applies to the next turn of every chat and cron session; a turn already running finishes on its account.</p></div>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {state.accounts.map((account) => (
            <li key={account.name} className={cn('grid grid-cols-[minmax(150px,1fr)_minmax(110px,150px)_minmax(110px,150px)_auto] items-center gap-4 rounded-sm border px-3 py-2.5 max-[760px]:grid-cols-2', account.active ? 'border-status-merged/50 bg-status-merged-bg' : 'border-border bg-surface-0')}>
              <span className="flex min-w-0 items-center gap-2 max-[760px]:col-span-2">
                {account.active ? <CheckCircle2 size={16} className="text-status-merged" aria-hidden="true" /> : <Circle size={16} className="text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0"><strong className="font-mono text-sm">{account.name}</strong>{account.active && <span className="ml-2 rounded-xs bg-status-merged-bg px-1.5 py-px font-mono text-[0.6rem] font-bold text-status-merged">IN USE</span>}
                  <small className="block text-[0.68rem] text-muted-foreground">{account.seenAt ? `usage seen ${time(account.seenAt)}` : 'no usage seen yet'}</small></span>
                {!account.active && <Button size="sm" className="ml-auto hidden max-[760px]:inline-flex" disabled={switching} onClick={() => void run(() => switchAccount({ variables: { name: account.name } }))}><ArrowRightLeft size={14} aria-hidden="true" />Use</Button>}
              </span>
              <Meter label="5h" window={account.fiveHour} now={now} />
              <Meter label="7d" window={account.sevenDay} now={now} />
              <span className="justify-self-end max-[760px]:hidden">
                {!account.active && <Button size="sm" disabled={switching} onClick={() => void run(() => switchAccount({ variables: { name: account.name } }))}><ArrowRightLeft size={14} aria-hidden="true" />Use</Button>}
              </span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 rounded-sm border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 flex-none" aria-hidden="true" />
          <span>An account's usage is known only while it is in use, so the others show the last numbers seen; a window past its reset shows none. Add or remove an account with the Coder parameters or <code className="font-mono">/cycle add</code> in a terminal, since that needs the token.</span>
        </p>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-8 flex-none place-items-center rounded-sm bg-surface-2 text-secondary-foreground"><RefreshCw size={16} aria-hidden="true" /></span>
          <div><h3 className="font-display text-base font-bold">Auto rotate</h3><p className="text-xs text-muted-foreground">Move to the next account before the current one hits its limit.</p></div>
        </div>
        <label className="flex items-center gap-3 text-sm"><Checkbox checked={rotation?.enabled ?? false} disabled={saving} onChange={(event) => void saveRotation({ enabled: event.target.checked })} />Rotate automatically</label>
        <div className={cn('grid grid-cols-3 gap-3 max-[760px]:grid-cols-2', !rotation?.enabled && 'opacity-60')}>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">Rotate when 5h reaches (%)
            <Input type="number" inputMode="numeric" min={50} max={100} value={limits.fiveHour} onChange={(event) => setLimits((current) => ({ ...current, fiveHour: event.target.value }))} onBlur={() => savePercent('fiveHour')} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">Rotate when 7d reaches (%)
            <Input type="number" inputMode="numeric" min={50} max={100} value={limits.sevenDay} onChange={(event) => setLimits((current) => ({ ...current, sevenDay: event.target.value }))} onBlur={() => savePercent('sevenDay')} />
          </label>
          <label className="flex items-center gap-3 self-end pb-2.5 text-sm max-[760px]:col-span-2"><Checkbox checked={rotation?.backToMain ?? true} disabled={saving} onChange={(event) => void saveRotation({ backToMain: event.target.checked })} />Back to main when it resets</label>
        </div>
        <p className="text-xs text-muted-foreground">Checked after each turn from the usage that turn reports, and every 5 minutes. The next account is the first in the list below both limits by its last seen numbers. When every account is over a limit, DOCK stays on the current one and tells you.</p>
        {state.log.length > 0 && (
          <ol className="m-0 flex list-none flex-col gap-1.5 border-t border-border p-0 pt-3 font-mono text-[0.72rem]">
            {state.log.map((entry) => (
              <li key={entry.at} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 max-[760px]:grid-cols-1 max-[760px]:gap-0.5">
                <span className="text-muted-foreground">{time(entry.at)}</span>
                <span className="text-secondary-foreground">{entry.from} → {entry.to} · {entry.reason}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
};
