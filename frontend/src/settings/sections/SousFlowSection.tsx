import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowRight, Flag, FlagTriangleRight, Hand, Lock, Play, Plus, RotateCcw, SkipForward, Trash2, UserCheck, Workflow } from 'lucide-react';
import { GET_SOUS_FLOW, GET_SOUS_FLOW_PROMPT, SET_SOUS_FLOW } from '../../graphql/queries';
import { Badge, Button, Checkbox, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import {
  DEFAULT_PROFILE, SOUS_STAGES, afterOf, newProfileName, parseSettings, profileNames, removeProfile, renameProfile, runningStages, setAfter, setRuns, stageIndex, withProfile,
  type SousFlowSettings, type SousStageId, type StageAfter,
} from '../../lib/sousFlow';
import { SettingsCard } from '../SettingsParts';
import { RulesCard } from './RulesCard';

const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : 'The sous flow could not be saved');
const sectionLabel = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const seg = (on: boolean, tone?: 'ask' | 'stop') => cn('inline-flex items-center gap-1.5 rounded-xs border px-2.5 py-1.5 text-[0.78rem] disabled:cursor-not-allowed disabled:opacity-45 max-[900px]:min-h-11',
  on ? (tone === 'stop' ? 'border-status-conflict/50 bg-status-conflict-bg text-status-conflict' : tone === 'ask' ? 'border-status-warn/50 bg-status-warn-bg text-status-warn' : 'border-accent bg-accent-dim text-foreground') : 'border-border bg-surface-1 text-secondary-foreground hover:border-border-glow');

const AFTER_HELP: Record<StageAfter, string> = {
  go: 'Lead writes a checkpoint, then carries on.',
  ask: 'Lead writes a checkpoint and waits for you to say continue.',
  stop: 'The flow ends here. A flow has only one stop point.',
};

/** Settings › Sous flow: the sous stages, per profile which run and what happens after each, and the checkpoint switch. Saves on each change. */
export const SousFlowSection = () => {
  const { data, loading } = useQuery<{ sousFlow: string }>(GET_SOUS_FLOW, { fetchPolicy: 'cache-and-network' });
  const [save, saving] = useMutation(SET_SOUS_FLOW, { refetchQueries: [GET_SOUS_FLOW], awaitRefetchQueries: true });
  const settings = parseSettings(data?.sousFlow);
  const [current, setCurrent] = useState(DEFAULT_PROFILE);
  const [selected, setSelected] = useState<SousStageId>('plan');
  const [error, setError] = useState<string | null>(null);
  const name = settings.profiles[current] ? current : DEFAULT_PROFILE;
  const profile = settings.profiles[name];
  const [rename, setRename] = useState(name);
  useEffect(() => { setRename(name); }, [name]);
  const { data: preview } = useQuery<{ sousFlowPrompt: { lines: string[]; prompt: string } }>(GET_SOUS_FLOW_PROMPT, { variables: { profile: name }, fetchPolicy: 'cache-and-network' });
  const busy = loading || saving.loading;
  const stage = SOUS_STAGES.find((item) => item.id === selected)!;
  const stopIndex = stageIndex(profile.stop);
  const after = afterOf(profile, selected);
  const skipped = profile.skip.includes(selected);
  const pastStop = stageIndex(selected) > stopIndex;

  const store = (next: SousFlowSettings | null) => {
    setError(null);
    save({ variables: { flow: next ? JSON.stringify(next) : '' } }).catch((failure: unknown) => setError(errorText(failure)));
  };
  const storeProfile = (next: typeof profile) => store(withProfile(settings, name, next));
  const addProfile = () => {
    const added = newProfileName(settings);
    store(withProfile(settings, added, { ...profile }));
    setCurrent(added);
  };
  const applyRename = () => {
    if (rename.trim() === name) return;
    const next = renameProfile(settings, name, rename);
    if (!next) {
      setError('That profile name is taken or empty.');
      setRename(name);
      return;
    }
    store(next);
    setCurrent(rename.trim());
  };

  const running = runningStages(profile).length;
  const asking = profile.ask.filter((id) => stageIndex(id) < stopIndex).length;
  const notRun = SOUS_STAGES.slice(stopIndex + 1).map((item) => item.title);

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="Checkpoint" caption="Lead writes a short report to DOCK each time an agent finishes, shown as a card in Sessions. When off, the command stays silent and sous runs as usual.">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={settings.checkpoint} disabled={busy} onChange={(event) => store({ ...settings, checkpoint: event.target.checked })} />
          Send checkpoints
        </label>
      </SettingsCard>

      <SettingsCard
        title="From Jira ticket to Jira status"
        caption="Your profile applies to tickets without their own flow. Set it per ticket in the ticket detail, per session in the Sessions composer. With every stage running and going on, the sous prompt stays exactly as it is now."
        aside={<Badge>{running} stages run · {asking} ask first</Badge>}
      >
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="listbox" aria-label="Profiles">
          {profileNames(settings).map((item) => (
            <button key={item} type="button" role="option" aria-selected={item === name} onClick={() => setCurrent(item)} className={cn('inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[0.8rem] max-[900px]:min-h-11', item === name ? 'border-accent bg-accent-dim text-foreground' : 'border-border bg-surface-1 text-secondary-foreground hover:border-border-glow')}>
              <Workflow size={14} aria-hidden="true" />{item}{item === settings.mine && <span className="font-mono text-[0.6rem] text-sky-200">· your profile</span>}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={addProfile} disabled={busy}><Plus size={14} aria-hidden="true" />New profile</Button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input aria-label="Profile name" className="h-9 w-56 max-w-full" value={rename} disabled={busy || name === DEFAULT_PROFILE} onChange={(event) => setRename(event.target.value)} onBlur={applyRename} onKeyDown={(event) => { if (event.key === 'Enter') applyRename(); }} />
          <Button size="sm" onClick={() => store({ ...settings, mine: name })} disabled={busy || settings.mine === name}><UserCheck size={14} aria-hidden="true" />Make it my profile</Button>
          <Button size="sm" variant="ghost" onClick={() => storeProfile({ skip: [], ask: [], stop: 'status' })} disabled={busy}><RotateCcw size={14} aria-hidden="true" />Run all</Button>
          {name !== DEFAULT_PROFILE && <Button size="sm" variant="ghost" onClick={() => { store(removeProfile(settings, name)); setCurrent(DEFAULT_PROFILE); }} disabled={busy}><Trash2 size={14} aria-hidden="true" />Delete profile</Button>}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-3.5 max-[1100px]:grid-cols-1">
          <div className="min-w-0">
            <div className="grid grid-cols-4 gap-2.5 max-[760px]:grid-cols-2" role="listbox" aria-label="Sous stages">
              {SOUS_STAGES.map((item, index) => {
                const head = index === 0 || SOUS_STAGES[index - 1].phase !== item.phase ? item.phase : null;
                const off = index > stopIndex;
                const skip = profile.skip.includes(item.id);
                const flag = afterOf(profile, item.id);
                return (
                  <React.Fragment key={item.id}>
                    {head && <p className={cn(sectionLabel, 'col-span-full mt-1 flex items-center gap-2 after:h-px after:flex-1 after:bg-border')}>{head}</p>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.id === selected}
                      onClick={() => setSelected(item.id)}
                      className={cn('relative flex min-h-[104px] flex-col items-start gap-1 rounded-md border border-border bg-surface-0 p-2.5 text-left', item.id === selected && 'border-accent', (off || skip) && 'opacity-55', flag === 'stop' && 'border-status-conflict/60', flag === 'ask' && !off && 'border-status-warn/60')}
                    >
                      {item.required && <Lock size={12} aria-label="Cannot be skipped" className="absolute top-2.5 right-2.5 text-muted-foreground" />}
                      <span className="font-mono text-[0.62rem] text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                      <span className="text-[0.8rem] font-semibold text-foreground">{item.title}</span>
                      <span className="font-mono text-[0.64rem] text-muted-foreground">{item.agent}</span>
                      <span className="mt-auto flex flex-wrap items-center gap-1">
                        <Badge>{off ? 'not run' : skip ? 'skip' : 'run'}</Badge>
                        {flag === 'stop' && <Badge variant="danger"><Flag size={10} aria-hidden="true" className="mr-0.5 inline" />stop</Badge>}
                        {flag === 'ask' && !off && <Badge variant="warn"><Hand size={10} aria-hidden="true" className="mr-0.5 inline" />ask first</Badge>}
                      </span>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-sm border border-dashed border-border-glow px-3 py-2 text-[0.8rem] text-secondary-foreground">
              {notRun.length === 0
                ? <><FlagTriangleRight size={15} aria-hidden="true" />Runs to the end, no stage cut off.</>
                : <><Flag size={15} aria-hidden="true" className="text-status-conflict" /><b className="text-foreground">Ends at {SOUS_STAGES[stopIndex].title}.</b> Not run: {notRun.join(', ')}.</>}
            </p>
          </div>

          <div className="rounded-md border border-border bg-surface-0 p-3.5 text-[0.82rem]">
            <p className="font-display text-[0.95rem] font-bold">{stage.title}</p>
            <p className="font-mono text-[0.68rem] text-muted-foreground">{stage.agent}</p>
            {pastStop && <p className="mt-2 rounded-xs border border-status-warn/40 bg-status-warn-bg px-2.5 py-1.5 text-[0.76rem] text-status-warn">This stage comes after the stop point, so it does not run. Move the stop point here to run it.</p>}
            <div className="border-b border-border py-2.5">
              <p className={cn(sectionLabel, 'mb-1.5')}>This stage</p>
              <div className="flex gap-1.5">
                <button type="button" className={seg(!skipped)} disabled={busy || !skipped} onClick={() => storeProfile(setRuns(profile, selected, true))}><Play size={13} aria-hidden="true" />Run</button>
                <button type="button" className={seg(skipped)} disabled={busy || skipped || Boolean(stage.required) || profile.stop === selected} onClick={() => storeProfile(setRuns(profile, selected, false))}><SkipForward size={13} aria-hidden="true" />Skip</button>
              </div>
              {stage.required && <p className="mt-1.5 text-xs text-muted-foreground">{selected === 'decide' ? 'Cannot be skipped. Only DOCK marks the PR ready after you answer in Decisions, but it can be the stop point.' : 'Cannot be skipped. The next stage needs its result.'}</p>}
              {selected === 'park' && <p className="mt-1.5 text-xs text-muted-foreground">Only happens when the ticket's AC is empty. The ticket stays parked until you click Confirm in Agents.</p>}
            </div>
            <div className="border-b border-border py-2.5">
              <p className={cn(sectionLabel, 'mb-1.5')}>When done</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={seg(after === 'go')} disabled={busy || skipped} onClick={() => storeProfile(setAfter(profile, selected, 'go'))}><ArrowRight size={13} aria-hidden="true" />Continue</button>
                <button type="button" className={seg(after === 'ask', 'ask')} disabled={busy || skipped || selected === 'status'} onClick={() => storeProfile(setAfter(profile, selected, 'ask'))}><Hand size={13} aria-hidden="true" />Ask first</button>
                <button type="button" className={seg(after === 'stop', 'stop')} disabled={busy || skipped || selected === 'status'} onClick={() => storeProfile(setAfter(profile, selected, 'stop'))}><Flag size={13} aria-hidden="true" />Stop</button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{AFTER_HELP[after]}</p>
            </div>
            {selected === 'video' && (
              <div className="border-b border-border py-2.5">
                <label className="flex items-center gap-2">
                  <Checkbox checked={settings.qaGuide} disabled={busy} onChange={(event) => store({ ...settings, qaGuide: event.target.checked })} />
                  Write a QA guide to Developer Context
                </label>
                <p className="mt-1.5 text-xs text-muted-foreground">When the ticket moves to UAT, DOCK writes one "QA guide (DOCK)" block in the Developer Context field: URL/route and menu path. It is replaced on every update; manual content and the Description are left alone.</p>
                <Input aria-label="Field Developer Context" className="mt-2 h-9 font-mono text-xs" defaultValue={settings.qaGuideField} key={settings.qaGuideField} disabled={busy} onBlur={(event) => { if (event.target.value.trim() !== settings.qaGuideField) store({ ...settings, qaGuideField: event.target.value.trim() }); }} />
              </div>
            )}
            {selected === 'decide' && (
              <p className="flex items-start gap-1.5 border-b border-border py-2.5 text-xs text-muted-foreground"><RotateCcw size={13} aria-hidden="true" className="mt-0.5 flex-none text-sky-200" /><span>Keep goes back to the DOCK gate, and DOCK marks the PR ready. Change or an answer starts a new sous session: revise, push to the same PR, back to the gate.</span></p>
            )}
            {stage.asks && <p className="pt-2.5 text-xs text-muted-foreground">Questions to the owner still go through Decisions (I-n). Blockers and decisions always stop.</p>}
          </div>
        </div>

        <div className="mt-3.5 overflow-hidden rounded-md border border-border bg-surface-0">
          <p className={cn(sectionLabel, 'flex flex-wrap justify-between gap-2 border-b border-border bg-surface-1 px-3 py-2')}><span>What DOCK sends sous when a session starts</span><span>{preview?.sousFlowPrompt.lines.length ? `+${preview.sousFlowPrompt.lines.length} flow lines` : 'same as now'}</span></p>
          <pre className="m-0 whitespace-pre-wrap px-3.5 py-3 font-mono text-[0.74rem] leading-[1.7] text-foreground">{preview?.sousFlowPrompt.prompt ?? '…'}</pre>
        </div>
        {error && <p className="mt-3 text-sm text-status-conflict" role="alert">{error}</p>}
      </SettingsCard>

      <div id="rules"><RulesCard /></div>
    </div>
  );
};
