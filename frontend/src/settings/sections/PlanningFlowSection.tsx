import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { RotateCcw, Workflow } from 'lucide-react';
import { GET_PLANNING_FLOW, SET_PLANNING_FLOW } from '../../graphql/queries';
import { Badge, Button, Checkbox, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { FLOW_TEMPLATES, PLAN_STAGES, PLAN_STAGE_ROLES, REQUIRED_STAGES, applyTemplate, parseFlow, updateStage, type PlanStageId, type PlanningFlow } from '../../agents/planningFlow';
import { SettingsCard } from '../SettingsParts';

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

  const store = (next: PlanningFlow | null) => {
    setError(null);
    save({ variables: { flow: next ? JSON.stringify(next) : '' } }).catch((failure: unknown) => setError(errorText(failure)));
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="Dari Jira sampai Publish"
        caption="Tahap yang dilewati nggak muncul di Planning › Draft dan nggak dihitung di Siap publish. Kosong berarti semua tahap jalan."
        aside={<Badge>{data?.planningFlow ? flow.template ?? 'Diubah' : 'Semua tahap jalan'}</Badge>}
      >
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {FLOW_TEMPLATES.map((template) => (
            <Button key={template.name} size="sm" variant={flow.template === template.name ? 'primary' : 'default'} onClick={() => store(applyTemplate(flow, template.name))} disabled={busy}>
              <Workflow size={14} aria-hidden="true" />{template.name}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => store(null)} disabled={busy || !data?.planningFlow}><RotateCcw size={14} aria-hidden="true" />Semua jalan</Button>
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
                    <Badge>{item.skip ? 'lewati' : 'jalan'}</Badge>
                    {item.approve && <Badge>perlu approve</Badge>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="rounded-md border border-border bg-surface-0 p-3.5 text-[0.82rem]">
            <p className="font-display text-[0.95rem] font-bold">{info.label}</p>
            <div className="border-b border-border py-2.5">
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Tahap ini</p>
              <div className="flex gap-1.5">
                <Button size="sm" variant={stage.skip ? 'default' : 'primary'} onClick={() => store(updateStage(flow, selected, { skip: false }))} disabled={busy || !stage.skip}>Jalan</Button>
                <Button size="sm" variant={stage.skip ? 'primary' : 'default'} onClick={() => store(updateStage(flow, selected, { skip: true }))} disabled={busy || required || stage.skip}>Lewati</Button>
              </div>
              {required && <p className="mt-1.5 text-xs text-muted-foreground">Nggak bisa dilewati.</p>}
            </div>
            <div className="border-b border-border py-2.5">
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Yang pegang</p>
              <Select aria-label={`Yang pegang ${info.label}`} value={stage.owner} onValueChange={(owner) => store(updateStage(flow, selected, { owner }))} options={PLAN_STAGE_ROLES.map((role) => ({ value: role, label: role }))} disabled={busy} />
            </div>
            <div className="py-2.5">
              <label className="flex items-center gap-2">
                <Checkbox checked={stage.approve} onChange={(event) => store(updateStage(flow, selected, { approve: event.target.checked }))} disabled={busy || stage.skip} />
                Perlu approve
              </label>
              <p className="mt-1 text-xs text-muted-foreground">Tahap berikutnya nunggu yang pegang tahap ini setuju.</p>
            </div>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-status-conflict" role="alert">{error}</p>}
      </SettingsCard>
    </div>
  );
};
