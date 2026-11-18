import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { RotateCcw, Workflow, Zap } from 'lucide-react';
import { GET_PLANNING_FLOW, GET_PLANNING_SPLIT_PAGE, SET_PLANNING_FLOW, SET_PLANNING_SPLIT_PAGE, TEST_PLANNING_SPLIT_PAGE } from '../../graphql/queries';
import { Badge, Button, Checkbox, Input, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { FLOW_TEMPLATES, PLAN_STAGES, PLAN_STAGE_ROLES, REQUIRED_STAGES, applyTemplate, parseFlow, updateStage, type PlanStageId, type PlanningFlow } from '../../agents/planningFlow';
import { Field, SettingsCard, TestResultText } from '../SettingsParts';

const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : 'The planning flow could not be saved');

/** Settings › Planning flow: the stages from Jira to Publish, who holds each, and which needs approval. Saves on each change. */
export const PlanningFlowSection = () => {
  const { data, loading } = useQuery<{ planningFlow: string | null }>(GET_PLANNING_FLOW, { fetchPolicy: 'cache-and-network' });
  const [save, saving] = useMutation(SET_PLANNING_FLOW, { refetchQueries: [GET_PLANNING_FLOW], awaitRefetchQueries: true });
  const [selected, setSelected] = useState<PlanStageId>('scope');
  const [error, setError] = useState<string | null>(null);
  const flow = parseFlow(data?.planningFlow);
  const stage = flow.stages.find((item) => item.id === selected)!;
  const info = PLAN_STAGES.find((item) => item.id === selected)!;
  const required = REQUIRED_STAGES.includes(selected);
  const busy = loading || saving.loading;

  const splitQuery = useQuery<{ planningSplitPage: string | null }>(GET_PLANNING_SPLIT_PAGE, { fetchPolicy: 'cache-and-network' });
  const [saveSplit, savingSplit] = useMutation(SET_PLANNING_SPLIT_PAGE, { refetchQueries: [GET_PLANNING_SPLIT_PAGE], awaitRefetchQueries: true });
  const [testSplit, testingSplit] = useMutation(TEST_PLANNING_SPLIT_PAGE);
  const [splitPage, setSplitPage] = useState<string | null>(null);
  const [splitResult, setSplitResult] = useState<{ ok: boolean; message: string } | undefined>();
  const splitSaved = splitQuery.data?.planningSplitPage ?? '';
  const splitValue = splitPage ?? splitSaved;

  const changeSplit = (value: string) => {
    setSplitPage(value);
    setSplitResult(undefined);
  };
  const storeSplit = () => {
    setError(null);
    saveSplit({ variables: { page: splitValue } }).then(() => setSplitPage(null)).catch((failure: unknown) => setError(errorText(failure)));
  };
  const runSplitTest = () => {
    testSplit({ variables: { page: splitValue } })
      .then((answer) => setSplitResult({ ok: Boolean(answer.data?.testPlanningSplitPage.success), message: answer.data?.testPlanningSplitPage.message ?? 'No answer' }))
      .catch((failure: unknown) => setSplitResult({ ok: false, message: errorText(failure) }));
  };

  const store = (next: PlanningFlow | null) => {
    setError(null);
    save({ variables: { flow: next ? JSON.stringify(next) : '' } }).catch((failure: unknown) => setError(errorText(failure)));
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="From Jira to Publish"
        caption="Skipped stages do not show in Planning › Draft and do not count toward Ready to publish. Empty means every stage runs."
        aside={<Badge>{data?.planningFlow ? flow.template ?? 'Changed' : 'All stages run'}</Badge>}
      >
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {FLOW_TEMPLATES.map((template) => (
            <Button key={template.name} size="sm" variant={flow.template === template.name ? 'primary' : 'default'} onClick={() => store(applyTemplate(flow, template.name))} disabled={busy}>
              <Workflow size={14} aria-hidden="true" />{template.name}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => store(null)} disabled={busy || !data?.planningFlow}><RotateCcw size={14} aria-hidden="true" />Run all</Button>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-3.5 max-[1000px]:grid-cols-1">
          <div className="grid grid-cols-4 gap-2.5 max-[760px]:grid-cols-2" role="listbox" aria-label="Planning stages">
            {flow.stages.map((item, index) => {
              const label = PLAN_STAGES.find((entry) => entry.id === item.id)!.label;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === selected}
                  onClick={() => setSelected(item.id)}
                  className={cn('flex min-h-[92px] flex-col items-start gap-1 rounded-md border border-border bg-surface-0 p-2.5 text-left', item.id === selected && 'border-accent', item.skip && 'opacity-55')}
                >
                  <span className="font-mono text-[0.62rem] text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                  <span className="text-[0.8rem] font-semibold text-foreground">{label}</span>
                  <span className="font-mono text-[0.64rem] text-muted-foreground">{item.owner}</span>
                  <span className="mt-auto flex flex-wrap gap-1">
                    <Badge>{item.skip ? 'skip' : 'run'}</Badge>
                    {item.approve && <Badge>needs approval</Badge>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="rounded-md border border-border bg-surface-0 p-3.5 text-[0.82rem]">
            <p className="font-display text-[0.95rem] font-bold">{info.label}</p>
            <div className="border-b border-border py-2.5">
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">This stage</p>
              <div className="flex gap-1.5">
                <Button size="sm" variant={stage.skip ? 'default' : 'primary'} onClick={() => store(updateStage(flow, selected, { skip: false }))} disabled={busy || !stage.skip}>Run</Button>
                <Button size="sm" variant={stage.skip ? 'primary' : 'default'} onClick={() => store(updateStage(flow, selected, { skip: true }))} disabled={busy || required || stage.skip}>Skip</Button>
              </div>
              {required && <p className="mt-1.5 text-xs text-muted-foreground">Cannot be skipped.</p>}
            </div>
            <div className="border-b border-border py-2.5">
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Owner</p>
              <Select aria-label={`Owner of ${info.label}`} value={stage.owner} onValueChange={(owner) => store(updateStage(flow, selected, { owner }))} options={PLAN_STAGE_ROLES.map((role) => ({ value: role, label: role }))} disabled={busy} />
            </div>
            <div className="py-2.5">
              <label className="flex items-center gap-2">
                <Checkbox checked={stage.approve} onChange={(event) => store(updateStage(flow, selected, { approve: event.target.checked }))} disabled={busy || stage.skip} />
                Needs approval
              </label>
              <p className="mt-1 text-xs text-muted-foreground">The next stage waits for this stage's owner to approve.</p>
            </div>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-status-conflict" role="alert">{error}</p>}
      </SettingsCard>

      <SettingsCard title="Split page" caption="A Confluence page whose table has the columns Ticket, Week and Note, read at Load from Jira. Planning lists the tickets that sit in another week; nothing changes until you click. A page id, a URL, or a title searched under the sprint contract parent page. Empty reads no page.">
        <Field label="Split page">
          <Input className="font-mono" placeholder="Sprint 28 split" value={splitValue} onChange={(event) => changeSplit(event.target.value)} />
        </Field>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={runSplitTest} disabled={testingSplit.loading || !splitValue.trim()}><Zap size={16} aria-hidden="true" />Test</Button>
          <Button variant="primary" onClick={storeSplit} disabled={savingSplit.loading || splitValue.trim() === splitSaved}>Save</Button>
          <TestResultText busy={testingSplit.loading} result={splitResult} />
        </div>
      </SettingsCard>
    </div>
  );
};
