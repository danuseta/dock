import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { X } from 'lucide-react';
import { GET_CHAT_MACHINES, GET_ORCHESTRATIONS, GET_ORCHESTRATOR_CRON_SETTINGS, GET_ORCHESTRATOR_CRON_STATUS } from '../graphql/queries';
import { RUN_ORCHESTRATOR_CRON_NOW, UPDATE_ORCHESTRATOR_CRON_SETTINGS } from '../graphql/mutations';
import { Button, Card, Checkbox, Dialog, Input, Select } from '../components/ui';
import { cn } from '../lib/cn';
import { ENGINE_HINT, ENGINE_OPTIONS, MODE_HINT, MODE_OPTIONS, WEEK_DAYS, configFromForm, fillSummary, formFromConfig, type CronForm } from './cronRound';

const SPRINT_OPTIONS = [{ value: 'active', label: 'Active sprint only' }, { value: 'any', label: 'Any sprint' }];

const Field = ({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) => (
  <div>
    <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <fieldset className="grid gap-4 border-t border-border pt-4">
    <legend className="pr-2 font-mono text-[0.68rem] font-bold uppercase tracking-wide text-muted-foreground">{title}</legend>
    {children}
  </fieldset>
);

/** The orchestrator cron settings, in a modal opened from the Agents page header. */
export const CronSettingsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { data, loading, refetch } = useQuery(GET_ORCHESTRATOR_CRON_SETTINGS, { fetchPolicy: 'network-only', skip: !open });
  const { data: machineData } = useQuery<{ chatMachines: Array<{ name: string; online: boolean }> }>(GET_CHAT_MACHINES, { skip: !open });
  const [save, { loading: saving }] = useMutation(UPDATE_ORCHESTRATOR_CRON_SETTINGS, { refetchQueries: [GET_ORCHESTRATOR_CRON_STATUS] });
  const [runNow, { loading: running }] = useMutation(RUN_ORCHESTRATOR_CRON_NOW, { refetchQueries: [GET_ORCHESTRATIONS, GET_ORCHESTRATOR_CRON_STATUS] });
  const [form, setForm] = useState<CronForm | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const settings = data?.orchestratorCronSettings;

  useEffect(() => {
    if (settings) setForm(formFromConfig(settings.config));
  }, [settings]);
  useEffect(() => {
    if (!open) setMessage(null);
  }, [open]);

  const set = <K extends keyof CronForm>(key: K, value: CronForm[K]) => form && setForm({ ...form, [key]: value });
  const text = (key: Exclude<keyof CronForm, 'enabled' | 'workDays' | 'engine'>) => ({ id: `cron-${key}`, value: form ? form[key] : '', onChange: (event: React.ChangeEvent<HTMLInputElement>) => set(key, event.target.value) });
  const machines = (machineData?.chatMachines || []).map((machine) => ({ value: machine.name, label: machine.online ? machine.name : `${machine.name} (offline)` }));
  const machineOptions = form && !machines.some((machine) => machine.value === form.machine) ? [...machines, { value: form.machine, label: form.machine }] : machines;
  const toggleDay = (day: number) => form && set('workDays', form.workDays.includes(day) ? form.workDays.filter((item) => item !== day) : [...form.workDays, day]);

  const act = async (work: () => Promise<string>, close = false) => {
    setMessage(null);
    try {
      const text = await work();
      await refetch();
      if (close) onClose();
      else setMessage({ text, failed: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Failed', failed: true });
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    void act(async () => {
      await save({ variables: { config: configFromForm(form) } });
      return 'Saved.';
    }, true);
  };

  const run = () => void act(async () => {
    const result = await runNow();
    return fillSummary(JSON.parse(result.data.runOrchestratorCronNow));
  });

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} dismissible={!saving} labelledBy="cron-title" describedBy="cron-description">
      <div ref={setPortal}>
        <Card className="flex max-h-[calc(100dvh-2rem)] w-[min(760px,calc(100vw-2rem))] flex-col overflow-hidden p-0 shadow-card">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 id="cron-title" className="font-display text-lg font-bold">Orchestrator cron</h2>
              <p id="cron-description" className="mt-1 text-pretty text-sm text-secondary-foreground">
                In work hours a free slot takes the next To Do ticket, lowest order number first. A ticket without acceptance criteria is parked until you confirm it.
              </p>
            </div>
            <Button size="sm" variant="ghost" aria-label="Close" onClick={onClose} disabled={saving}><X size={16} aria-hidden="true" /></Button>
          </div>

          {!form ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">{loading ? 'Loading the cron settings...' : 'The cron settings could not be loaded.'}</p>
          ) : (
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-5 py-4">
                <label className="flex items-center gap-3 text-sm font-medium">
                  <Checkbox checked={form.enabled} onChange={(event) => set('enabled', event.target.checked)} />
                  Cron on
                </label>

                <Section title="Slots">
                  <div className="grid grid-cols-3 gap-4 max-[640px]:grid-cols-1">
                    <Field id="cron-parallel" label="Agents at once" hint="1 to 5. One ticket per agent; manual chats are not counted.">
                      <Input {...text('parallel')} inputMode="numeric" />
                    </Field>
                    <Field id="cron-maxPerDay" label="New tickets per day" hint="1 to 50. Parked tickets have the same cap.">
                      <Input {...text('maxPerDay')} inputMode="numeric" />
                    </Field>
                    <Field id="cron-machine" label="Machine">
                      <Select id="cron-machine" aria-label="Machine" value={form.machine} onValueChange={(value) => set('machine', value)} options={machineOptions} container={portal} />
                    </Field>
                  </div>
                </Section>

                <Section title="Work hours (WIB)">
                  <div className="grid grid-cols-4 gap-4 max-[640px]:grid-cols-2">
                    <Field id="cron-workStart" label="From hour" hint="0 to 23.">
                      <Input {...text('workStart')} inputMode="numeric" />
                    </Field>
                    <Field id="cron-workEnd" label="Until hour" hint="1 to 24, not included.">
                      <Input {...text('workEnd')} inputMode="numeric" />
                    </Field>
                    <Field id="cron-activeFrom" label="Active from" hint="Empty: no start date.">
                      <Input {...text('activeFrom')} type="date" />
                    </Field>
                    <Field id="cron-activeUntil" label="Active until" hint="Empty: no end date.">
                      <Input {...text('activeUntil')} type="date" />
                    </Field>
                  </div>
                  <div role="group" aria-label="Work days" className="flex flex-wrap gap-1.5">
                    {WEEK_DAYS.map((day) => {
                      const on = form.workDays.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleDay(day.value)}
                          className={cn('min-h-9 min-w-12 rounded-sm border px-3 font-mono text-xs font-bold max-[760px]:min-h-11', on ? 'border-accent/50 bg-accent-dim text-accent' : 'border-border text-muted-foreground hover:text-foreground')}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">Outside these hours no new ticket is taken. A running turn finishes, and an answer you give still runs when a slot is free.</p>
                </Section>

                <Section title="How the agent works">
                  <div className="grid grid-cols-3 gap-4 max-[640px]:grid-cols-1">
                    <Field id="cron-engine" label="Engine" hint={ENGINE_HINT[form.engine]}>
                      <Select id="cron-engine" aria-label="Engine" value={form.engine} onValueChange={(value) => set('engine', value)} options={ENGINE_OPTIONS} container={portal} />
                    </Field>
                    <Field id="cron-mode" label="Permission mode" hint={MODE_HINT[form.mode]}>
                      <Select id="cron-mode" aria-label="Permission mode" value={form.mode} onValueChange={(value) => set('mode', value)} options={MODE_OPTIONS} container={portal} />
                    </Field>
                    <Field id="cron-model" label="Model" hint="Empty uses the machine's default.">
                      <Input {...text('model')} placeholder="default" />
                    </Field>
                    <Field id="cron-effort" label="Effort" hint="Empty uses the machine's default.">
                      <Input {...text('effort')} placeholder="default" />
                    </Field>
                  </div>
                </Section>

                <Section title="Which tickets">
                  <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
                    <Field id="cron-sprint" label="Tickets from">
                      <Select id="cron-sprint" aria-label="Tickets from" value={form.sprint} onValueChange={(value) => set('sprint', value)} options={SPRINT_OPTIONS} container={portal} />
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
                    <Field id="cron-usageBrakePercent" label="Usage brake (%)" hint="No new ticket while the 5 hour usage is at or above this.">
                      <Input {...text('usageBrakePercent')} inputMode="numeric" />
                    </Field>
                  </div>
                </Section>

                <p className="text-xs text-secondary-foreground" role="status">Last fill: {fillSummary(settings ? JSON.parse(settings.lastFill) : null)}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
                <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
                <Button type="button" disabled={running || saving} onClick={run}>{running ? 'Running...' : 'Fill now'}</Button>
                {message && <span role="status" className={cn('text-pretty text-sm', message.failed ? 'text-status-conflict' : 'text-status-merged')}>{message.text}</span>}
              </div>
            </form>
          )}
        </Card>
      </div>
    </Dialog>
  );
};
