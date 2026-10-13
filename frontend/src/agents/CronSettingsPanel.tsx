import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_CHAT_MACHINES, GET_ORCHESTRATIONS, GET_ORCHESTRATOR_CRON_SETTINGS } from '../graphql/queries';
import { RUN_ORCHESTRATOR_CRON_NOW, UPDATE_ORCHESTRATOR_CRON_SETTINGS } from '../graphql/mutations';
import { Button, Card, Checkbox, Input, Select } from '../components/ui';
import { configFromForm, formFromConfig, roundSummary, type CronForm } from './cronRound';

const SPRINT_OPTIONS = [{ value: 'active', label: 'Active sprint only' }, { value: 'any', label: 'Any sprint' }];

const Field = ({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) => (
  <div>
    <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
);

export const CronSettingsPanel = () => {
  const { data, loading, refetch } = useQuery(GET_ORCHESTRATOR_CRON_SETTINGS, { fetchPolicy: 'network-only' });
  const { data: machineData } = useQuery<{ chatMachines: Array<{ name: string; online: boolean }> }>(GET_CHAT_MACHINES);
  const [save, { loading: saving }] = useMutation(UPDATE_ORCHESTRATOR_CRON_SETTINGS);
  const [runNow, { loading: running }] = useMutation(RUN_ORCHESTRATOR_CRON_NOW, { refetchQueries: [GET_ORCHESTRATIONS] });
  const [form, setForm] = useState<CronForm | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const settings = data?.orchestratorCronSettings;

  useEffect(() => {
    if (settings) setForm(formFromConfig(settings.config));
  }, [settings]);

  if (!form) return <Card className="mb-4 text-sm text-muted-foreground">{loading ? 'Loading the cron settings...' : 'The cron settings could not be loaded.'}</Card>;

  const set = <K extends keyof CronForm>(key: K, value: CronForm[K]) => setForm({ ...form, [key]: value });
  const text = (key: Exclude<keyof CronForm, 'enabled'>) => ({ id: `cron-${key}`, value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement>) => set(key, event.target.value) });
  const machines = (machineData?.chatMachines || []).map((machine) => ({ value: machine.name, label: machine.online ? machine.name : `${machine.name} (offline)` }));
  const machineOptions = machines.some((machine) => machine.value === form.machine) ? machines : [...machines, { value: form.machine, label: form.machine }];

  const act = async (work: () => Promise<string>) => {
    setMessage(null);
    try {
      setMessage({ text: await work(), failed: false });
      await refetch();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Failed', failed: true });
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await save({ variables: { config: configFromForm(form), webhookUrl: webhookUrl.trim() || null } });
      setWebhookUrl('');
      return 'Saved.';
    });
  };

  const run = () => void act(async () => {
    const result = await runNow();
    return roundSummary(JSON.parse(result.data.runOrchestratorCronNow));
  });

  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="grid gap-5">
        <div>
          <h2 className="font-display text-lg font-bold">Orchestrator cron</h2>
          <p className="mt-1 text-pretty text-sm text-secondary-foreground">Starts an agent on your To Do tickets at the hours below. A ticket without acceptance criteria is parked until you confirm it.</p>
        </div>

        <label className="flex items-center gap-3 text-sm font-medium">
          <Checkbox checked={form.enabled} onChange={(event) => set('enabled', event.target.checked)} />
          Run on schedule
        </label>

        <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
          <Field id="cron-hoursWib" label="Hours (WIB)" hint="0 to 23, separated by commas. Example: 9, 14">
            <Input {...text('hoursWib')} inputMode="numeric" />
          </Field>
          <Field id="cron-machine" label="Machine">
            <Select id="cron-machine" aria-label="Machine" value={form.machine} onValueChange={(value) => set('machine', value)} options={machineOptions} />
          </Field>
          <Field id="cron-usageBrakePercent" label="Usage brake (%)" hint="A round is skipped when the 5 hour usage is at or above this.">
            <Input {...text('usageBrakePercent')} inputMode="numeric" />
          </Field>
          <Field id="cron-parallel" label="Agents at once" hint="1 to 5.">
            <Input {...text('parallel')} inputMode="numeric" />
          </Field>
          <Field id="cron-perRound" label="Tickets per round" hint="1 to 10, parked tickets included.">
            <Input {...text('perRound')} inputMode="numeric" />
          </Field>
          <Field id="cron-sprint" label="Tickets from">
            <Select id="cron-sprint" aria-label="Tickets from" value={form.sprint} onValueChange={(value) => set('sprint', value)} options={SPRINT_OPTIONS} />
          </Field>
          <Field id="cron-labels" label="Only these labels" hint="Separated by commas. Empty means every label.">
            <Input {...text('labels')} />
          </Field>
          <Field id="cron-todoStatuses" label="Jira statuses to pick up" hint="Separated by commas.">
            <Input {...text('todoStatuses')} />
          </Field>
          <Field id="cron-inProgressStatus" label="Move a started ticket to">
            <Input {...text('inProgressStatus')} />
          </Field>
          <Field id="cron-model" label="Model" hint="Empty uses the machine's default.">
            <Input {...text('model')} placeholder="default" />
          </Field>
          <Field id="cron-effort" label="Effort" hint="Empty uses the machine's default.">
            <Input {...text('effort')} placeholder="default" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4 max-[700px]:grid-cols-1">
          <Field id="cron-webhook" label="Discord webhook for pings" hint="A webhook in your own private server. You are pinged when a ticket is parked, an agent asks, or a pull request waits for your review.">
            <Input id="cron-webhook" type="password" autoComplete="off" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder={settings?.webhookSet ? 'Saved. Paste a new URL to replace it.' : 'https://discord.com/api/webhooks/...'} />
          </Field>
          <Field id="cron-notifyUserId" label="Your Discord user id" hint="Digits only. Used for the mention in each ping.">
            <Input {...text('notifyUserId')} inputMode="numeric" />
          </Field>
        </div>

        <p className="text-xs text-secondary-foreground" role="status">Last round: {roundSummary(settings ? JSON.parse(settings.lastRound) : null)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</Button>
          <Button type="button" disabled={running} onClick={run}>{running ? 'Running...' : 'Run a round now'}</Button>
          {message && <span role="status" className={message.failed ? 'text-sm text-status-conflict' : 'text-sm text-status-merged'}>{message.text}</span>}
        </div>
      </form>
    </Card>
  );
};
