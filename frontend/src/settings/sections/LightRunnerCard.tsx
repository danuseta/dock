import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowRight, Lock } from 'lucide-react';
import { GET_SETTINGS } from '../../graphql/queries';
import { UPDATE_SETTINGS } from '../../graphql/mutations';
import { Checkbox, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import { LIGHT_RANGES, lightSteps, type LightValues } from '../../lib/lightRunner';
import { SettingRow, SettingsCard } from '../SettingsParts';

const sectionLabel = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const seg = (on: boolean) => cn('inline-flex items-center rounded-xs border px-2.5 py-1.5 text-[0.78rem] disabled:cursor-not-allowed disabled:opacity-45 max-[900px]:min-h-11', on ? 'border-accent bg-accent-dim text-foreground' : 'border-border bg-surface-1 text-secondary-foreground hover:border-border-glow');

export const LockedValue = ({ children }: { children: string }) => <span className="inline-flex items-center gap-2 rounded-xs border border-border bg-surface-0 px-2.5 py-1.5 text-xs text-secondary-foreground"><Lock size={12} aria-hidden="true" className="flex-none" />{children}</span>;

type LightKey = keyof typeof LIGHT_RANGES;

const NumberInput = ({ name, label, value, disabled, onSave, className }: { name: LightKey; label: string; value: number; disabled: boolean; onSave: (key: LightKey, value: number) => void; className?: string }) => {
  const range = LIGHT_RANGES[name];
  const [text, setText] = useState(String(value));
  const number = Number(text);
  const valid = text.trim() !== '' && Number.isInteger(number) && number >= range.min && number <= range.max;
  return (
    <span className="inline-flex flex-col gap-1">
      <Input type="number" min={range.min} max={range.max} aria-label={label} aria-invalid={!valid} className={cn('h-9 w-24 font-mono', className)} value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} onBlur={() => { if (valid && number !== value) onSave(name, number); else setText(String(value)); }} />
      {!valid && <span className="text-xs text-status-conflict" role="alert">{range.min} to {range.max}</span>}
    </span>
  );
};

/** Settings › Sous flow › Light runner: the rows sous-light-runner reads at job start. A locked row is a rule, not a setting. Saves on each change. */
export const LightRunnerCard = () => {
  const { data } = useQuery<{ settings: LightValues }>(GET_SETTINGS, { fetchPolicy: 'cache-first' });
  const [update, { loading }] = useMutation(UPDATE_SETTINGS, { refetchQueries: [GET_SETTINGS], awaitRefetchQueries: true });
  const [error, setError] = useState<string | null>(null);
  const light = data?.settings;
  if (!light || typeof light.lightRunnerOn !== 'boolean') return null;
  const store = (patch: Record<string, string | number>) => {
    setError(null);
    update({ variables: { input: patch } }).then((result) => { if (result.data?.updateSettings !== true) setError('Not saved. Check the connection, then try again.'); }, () => setError('Not saved. Check the connection, then try again.'));
  };
  const toggle = (key: string, label: string, help: string | undefined, on: boolean, disabled = false) => (
    <SettingRow label={label} help={help}>
      <label className="inline-flex items-center gap-2 text-sm"><Checkbox aria-label={label} checked={on} disabled={loading || disabled} onChange={(event) => store({ [key]: String(event.target.checked) })} />{on ? 'on' : 'off'}</label>
    </SettingRow>
  );
  const save = (key: LightKey, value: number) => store({ [key]: value });
  const steps = lightSteps(light);
  return (
    <SettingsCard title="Light runner" caption="Small fixes skip intake, planner, the reviewer loop, the final review and the video. Every run still writes the ledger. The settings are read when a job starts, so a change does not touch a job that is running.">
      <div className="mb-1 flex flex-wrap items-center gap-1.5 rounded-sm border border-border bg-surface-1 px-3 py-2 font-mono text-[0.7rem] text-secondary-foreground">
        {steps.length ? steps.flatMap((step, index) => [index > 0 ? <ArrowRight key={`arrow-${step}`} size={11} aria-hidden="true" className="text-muted-foreground" /> : null, <span key={step}>{step}</span>]) : <span className="text-status-warn">off: every fix takes the full runner</span>}
      </div>
      {toggle('lightRunnerOn', 'Light runner', 'Off sends every fix through the full runner.', light.lightRunnerOn)}
      <p className={cn(sectionLabel, 'mt-4 mb-0')}>Used for</p>
      {toggle('lightForFindings', 'Review findings after on it', 'The findings of a round go light when they pass the gate.', light.lightForFindings, !light.lightRunnerOn)}
      {toggle('lightForParty', 'Tickets whose Party says mode: light', undefined, light.lightForParty, !light.lightRunnerOn)}
      {toggle('lightForRetro', 'Retro apply that changes code', undefined, light.lightForRetro, !light.lightRunnerOn)}
      <p className={cn(sectionLabel, 'mt-4 mb-0')}>Entry gate</p>
      <SettingRow label="Scout (step 1)" help="Read only. It measures repos, files and lines before the gate decides."><LockedValue>always on</LockedValue></SettingRow>
      <SettingRow label="Max production lines" help="Tests are not counted."><NumberInput name="lightMaxLines" label="Max production lines" value={light.lightMaxLines} disabled={loading} onSave={save} /></SettingRow>
      <SettingRow label="Max production files"><NumberInput name="lightMaxFiles" label="Max production files" value={light.lightMaxFiles} disabled={loading} onSave={save} /></SettingRow>
      <SettingRow label="One repo per job" help="A BE and FE fix becomes two jobs."><LockedValue>fixed</LockedValue></SettingRow>
      <SettingRow label="No AC, scope or contract change, no open issue to the owner" help="These need a person, so they always go to the full runner."><LockedValue>fixed</LockedValue></SettingRow>
      <p className={cn(sectionLabel, 'mt-4 mb-0')}>Steps</p>
      <SettingRow label="Worker model" help="sous-ticket-worker">
        <span className="flex gap-1.5" role="radiogroup" aria-label="Worker model">{['sonnet', 'haiku'].map((model) => <button key={model} type="button" role="radio" aria-checked={light.lightWorkerModel === model} disabled={loading} className={seg(light.lightWorkerModel === model)} onClick={() => light.lightWorkerModel !== model && store({ lightWorkerModel: model })}>{model}</button>)}</span>
      </SettingRow>
      <SettingRow label="Verifier" help="Runs under the verify lock."><LockedValue>always on</LockedValue></SettingRow>
      {toggle('lightBrowserCheck', 'Browser check when the fix touches FE', 'Screenshots in dark mode.', light.lightBrowserCheck)}
      <SettingRow label="Blast check" help="Affected symbols are checked, and the work goes back to the worker up to the number of times set here.">
        <span className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm"><Checkbox aria-label="Blast check" checked={light.lightBlastCheck} disabled={loading} onChange={(event) => store({ lightBlastCheck: String(event.target.checked) })} />{light.lightBlastCheck ? 'on' : 'off'}</label>
          <span className="text-xs text-muted-foreground">back to worker at most</span>
          <NumberInput name="lightBlastLoops" label="Blast check loops" value={light.lightBlastLoops} disabled={loading || !light.lightBlastCheck} onSave={save} className="w-16" />
        </span>
      </SettingRow>
      <SettingRow label="Publish">
        <span className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Publish">{[['push', 'Push to the PR branch'], ['draft', 'Open a draft PR']].map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={light.lightPublish === value} disabled={loading} className={seg(light.lightPublish === value)} onClick={() => light.lightPublish !== value && store({ lightPublish: value })}>{label}</button>)}</span>
      </SettingRow>
      <SettingRow label="Gate fails mid-run"><LockedValue>stop, continue in the full runner from that task</LockedValue></SettingRow>
      {error && <p className="mt-3 text-sm text-status-conflict" role="alert">{error}</p>}
    </SettingsCard>
  );
};
