import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Save } from 'lucide-react';
import { GET_JUDGE_SETTINGS, SET_JUDGE_SETTINGS } from '../../graphql/queries';
import { Badge, Button, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import { SettingRow, SettingsCard } from '../SettingsParts';
import { readJudgeSettings, type JudgeSettingsForm } from '../judgeSettings';

const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : 'The Judge settings could not be saved');

/** Settings › Judge: on or off, the Claude account it runs on, its windows, when a session counts as quiet and the answer cutoff. */
export const JudgeSection = () => {
  const { data, loading } = useQuery<{ judgeSettings: string }>(GET_JUDGE_SETTINGS, { fetchPolicy: 'cache-and-network' });
  const [save, saving] = useMutation(SET_JUDGE_SETTINGS, { refetchQueries: [GET_JUDGE_SETTINGS], awaitRefetchQueries: true });
  const saved = readJudgeSettings(data?.judgeSettings);
  const [draft, setDraft] = useState<JudgeSettingsForm>(saved);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => { setDraft(readJudgeSettings(data?.judgeSettings)); }, [data?.judgeSettings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const change = (next: Partial<JudgeSettingsForm>) => { setDone(false); setDraft((current) => ({ ...current, ...next })); };
  const setWindow = (index: number, field: 'from' | 'to', value: string) => change({ windows: draft.windows.map((window, at) => (at === index ? { ...window, [field]: value } : window)) });
  const store = () => {
    setError(null);
    save({ variables: { settings: JSON.stringify(draft) } }).then(() => setDone(true)).catch((failure: unknown) => setError(errorText(failure)));
  };
  const busy = loading || saving.loading;
  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="Judge"
        caption="Judge reads the transcripts of the sprint's ticket sessions after they go quiet, records what the agent did wrong, and feeds the retro. It never touches tickets or code."
        aside={<Badge variant={saved.on ? 'success' : 'neutral'}>{saved.on ? 'On' : 'Off'}</Badge>}
      >
        <SettingRow label="Judge" help="Off by default. While off, nothing is queued and no Judge session opens.">
          <span className="inline-flex overflow-hidden rounded-xs border border-border-glow font-mono text-[0.72rem]" role="radiogroup" aria-label="Judge on or off">
            {([true, false] as const).map((on) => (
              <button key={String(on)} type="button" role="radio" aria-checked={draft.on === on} disabled={busy} onClick={() => change({ on })} className={cn('px-3 py-1.5 max-[760px]:min-h-11', draft.on === on ? 'bg-surface-hover font-bold text-foreground' : 'text-secondary-foreground hover:bg-surface-1')}>{on ? 'On' : 'Off'}</button>
            ))}
          </span>
        </SettingRow>
        <SettingRow label="Claude account" help="The account Judge sessions run on, so they never share a quota window with work. Empty uses the machine's active account.">
          <Input aria-label="Judge account" placeholder="claude4" value={draft.account} onChange={(event) => change({ account: event.target.value.trim() })} disabled={busy} />
        </SettingRow>
        {draft.windows.map((window, index) => (
          <SettingRow key={index} label={`Window ${index + 1} (WIB)`} help={index === 0 ? 'Judge starts a session only inside a window and only while DOCK is quiet. Judge now runs outside them.' : 'Leftovers of the night run here.'}>
            <span className="flex items-center gap-2">
              <Input aria-label={`Window ${index + 1} from`} type="time" value={window.from} onChange={(event) => setWindow(index, 'from', event.target.value)} disabled={busy} />
              <span className="text-muted-foreground">to</span>
              <Input aria-label={`Window ${index + 1} to`} type="time" value={window.to} onChange={(event) => setWindow(index, 'to', event.target.value)} disabled={busy} />
            </span>
          </SettingRow>
        ))}
        <SettingRow label="Idle minutes" help="A session with no turn for this long is queued. A ticket that moves to PR Review or UAT queues it at once.">
          <Input aria-label="Idle minutes" type="number" min={5} max={1440} value={draft.idleMinutes} onChange={(event) => change({ idleMinutes: Number(event.target.value) })} disabled={busy} />
        </SettingRow>
        <SettingRow label="Answer cutoff (next day, WIB)" help="A day not confirmed by then keeps Judge's call. You can still change it until the sprint sheet is accepted.">
          <Input aria-label="Answer cutoff" type="time" value={draft.noonCutoff} onChange={(event) => change({ noonCutoff: event.target.value })} disabled={busy} />
        </SettingRow>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="primary" onClick={store} disabled={busy || !dirty}><Save size={14} aria-hidden="true" />Save</Button>
          {done && !dirty && <span className="text-xs text-status-merged" role="status">Saved.</span>}
          {error && <span className="text-xs text-status-conflict" role="alert">{error}</span>}
        </div>
      </SettingsCard>
    </div>
  );
};
