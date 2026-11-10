import React, { useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { Check, ExternalLink, FileSearch, Undo2, Upload } from 'lucide-react';
import { Button, Checkbox, Select } from '../components/ui';
import { UPLOAD_SPRINT_STORYBOARD } from '../graphql/queries';
import { apiOrigin } from '../lib/apollo';
import { cn } from '../lib/cn';
import { storyboardDecisionId, type SprintDraft, type StoryboardFlow } from './planning';
import { changedFlowCount, flowTickets, versionLabel, visibleGroups } from './storyboardLogic';

const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const chip = 'rounded-xs border px-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em]';
const TONE = { ok: 'border-status-merged text-status-merged', conflict: 'border-status-conflict text-status-conflict', warn: 'border-status-warn text-status-warn', none: 'border-border text-muted-foreground', note: 'border-accent text-accent' };
const SCREEN = { width: 1512, height: 982 };
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const INFO_LABELS = ['Awal', 'Langkah', 'Hasil'];

const htmlOf = (url: string | null | undefined, flowId: string) => (url ? `${apiOrigin}${url}#${encodeURIComponent(flowId)}` : null);

/** The saved storyboard at one flow, in a sandboxed frame drawn at the artifact's screen size and scaled to fit. */
const ScaledFrame: React.FC<{ src: string; title: string }> = ({ src, title }) => {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = width / SCREEN.width;
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-md border border-border bg-surface-1" style={{ height: Math.round(SCREEN.height * scale) || 120 }}>
      {width > 0 && (
        <iframe
          key={src}
          src={src}
          title={title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="absolute left-0 top-0 origin-top-left border-0"
          style={{ width: SCREEN.width, height: SCREEN.height, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
};

const TicketRows: React.FC<{ keys: string[]; flow: StoryboardFlow; draft: SprintDraft; busy: boolean; onDecide: (id: string, action: string) => void }> = ({ keys, flow, draft, busy, onDecide }) => (
  <ul className="overflow-hidden rounded-md border border-border bg-surface-0">
    {keys.map((key) => {
      const ticket = draft.tickets.find((item) => item.key === key);
      const flag = ticket?.storyboard && ticket.storyboard.frames.includes(flow.id) ? ticket.storyboard : null;
      return (
        <li key={key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem]">
              <span className="font-mono font-semibold">{key}</span>
              {flag
                ? <span className={cn(chip, flag.checked ? TONE.none : flag.held ? TONE.conflict : TONE.warn)}>{flag.checked ? 'AC checked' : flag.held ? 'Held · AC needs a check' : 'AC needs a check'}</span>
                : <span className={cn(chip, ticket ? TONE.note : TONE.none)}>{ticket ? 'in sprint · open' : 'not open in this sprint'}</span>}
              {ticket && <span className="text-muted-foreground">{ticket.status}{ticket.dev ? ` · ${ticket.dev}` : ''}</span>}
            </p>
            {ticket && <p className="mt-0.5 truncate text-[0.78rem] text-secondary-foreground">{ticket.summary}</p>}
          </div>
          {flag && (
            <div className="flex flex-wrap items-start justify-end gap-1.5 max-[760px]:justify-start">
              {flag.checked
                ? <Button size="sm" variant="ghost" onClick={() => onDecide(storyboardDecisionId(key, flag.version), 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>
                : <Button size="sm" variant="primary" onClick={() => onDecide(storyboardDecisionId(key, flag.version), 'checked')} disabled={busy}><Check size={13} aria-hidden="true" />AC checked</Button>}
            </div>
          )}
        </li>
      );
    })}
  </ul>
);

/** The storyboard as a board: scenario, flows by group with their tickets, and the flow's frames from the saved HTML. */
export const StoryboardBoard: React.FC<{ draft: SprintDraft; busy: boolean; onCheck: () => void; onDecide: (id: string, action: string, note?: string) => void }> = ({ draft, busy, onCheck, onDecide }) => {
  const epics = [...new Set([...draft.storyboards.map((board) => board.epic), ...draft.tickets.map((ticket) => ticket.epic).filter((epic): epic is string => !!epic)])].sort();
  const [epic, setEpic] = useState<string>('');
  const [scenarioN, setScenarioN] = useState<number | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [only, setOnly] = useState(false);
  const [compare, setCompare] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [upload, uploading] = useMutation(UPLOAD_SPRINT_STORYBOARD, { refetchQueries: ['GetSprintDraft'] });

  const currentEpic = epics.includes(epic) ? epic : epics[0] ?? '';
  const board = draft.storyboards.find((item) => item.epic === currentEpic);
  const scenarios = board?.scenarios ?? [];
  const scenario = scenarios.find((item) => item.n === scenarioN) ?? scenarios[0];
  const groups = visibleGroups(scenario, draft.tickets, only);
  const shown = groups.flatMap((group) => group.flows);
  const flow = shown.find((item) => item.id === flowId) ?? shown[0];
  const changed = changedFlowCount(board);
  const working = busy || uploading.loading;

  const pick = (id: string) => { setFlowId(id); setCompare(null); };
  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !currentEpic) return;
    setNotice(null);
    if (file.size > MAX_UPLOAD_BYTES) { setNotice('The storyboard is larger than 8 MB'); return; }
    try {
      await upload({ variables: { sprint: draft.sprint, epic: currentEpic, html: await file.text() } });
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'The storyboard could not be uploaded');
    }
  };

  const openUrl = flow ? htmlOf(board?.htmlUrl, flow.id) : board?.htmlUrl ? `${apiOrigin}${board.htmlUrl}` : null;
  const compared = flow && compare !== null ? flow.frames[compare] : undefined;

  return (
    <section aria-label="Storyboard" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {epics.length > 1 && <Select aria-label="Epic" className="h-8 w-auto min-w-[8rem] text-xs" value={currentEpic} onValueChange={(value) => { setEpic(value); setScenarioN(null); setFlowId(null); setCompare(null); }} options={epics.map((value) => ({ value, label: value }))} />}
        {scenarios.length > 0 && <Select aria-label="Scenario" className="h-8 w-auto min-w-0 max-w-full text-xs" value={String(scenario?.n ?? '')} onValueChange={(value) => { setScenarioN(Number(value)); setFlowId(null); setCompare(null); }} options={scenarios.map((item) => ({ value: String(item.n), label: `${item.n}. ${item.title}` }))} />}
        {board?.version ? <span className={cn(chip, TONE.none)}>{versionLabel(board.version)}</span> : null}
        {changed > 0 && <span className={cn(chip, TONE.conflict)}>{changed} {changed === 1 ? 'flow' : 'flows'} changed</span>}
        <label className="flex items-center gap-2 text-[0.76rem] text-muted-foreground"><Checkbox checked={only} onChange={(event) => setOnly(event.target.checked)} />only flows with this sprint's tickets</label>
        <span className="flex-1" />
        <Button size="sm" onClick={onCheck} disabled={working}><FileSearch size={13} aria-hidden="true" />Check storyboard</Button>
        <Button size="sm" onClick={() => fileInput.current?.click()} disabled={working || !currentEpic}><Upload size={13} aria-hidden="true" />Upload storyboard HTML</Button>
        <input ref={fileInput} type="file" accept=".html,.htm,text/html" className="hidden" onChange={onFile} aria-label="Storyboard HTML file" />
        {openUrl && <a className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface-2 px-3 font-display text-xs font-semibold text-foreground hover:border-border-glow max-[760px]:h-11" href={openUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" />Open storyboard</a>}
      </div>
      {notice && <p className="text-pretty text-[0.78rem] text-status-conflict" role="alert">{notice}</p>}
      {board?.error && <p className="text-pretty text-[0.78rem] text-status-warn">{currentEpic}: {board.error}</p>}
      {!epics.length && <p className="text-sm text-muted-foreground">No ticket of this sprint has an epic, so there is no storyboard to read.</p>}
      {epics.length > 0 && !scenarios.length && !board?.error && <p className="text-sm text-muted-foreground">No storyboard read yet for {currentEpic}. Check storyboard reads it from Confluence, or upload the storyboard HTML.</p>}

      {scenarios.length > 0 && (
        <div className="grid min-w-0 grid-cols-[16rem_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-surface-0 max-[760px]:grid-cols-[minmax(0,1fr)]">
          <nav aria-label="Flows" className="max-h-[40rem] min-w-0 overflow-y-auto border-r border-border max-[760px]:max-h-64 max-[760px]:border-b max-[760px]:border-r-0">
            {groups.length === 0 && <p className="p-3 text-[0.76rem] text-muted-foreground">No flow of this scenario lists an open ticket of this sprint.</p>}
            {groups.map((group) => (
              <div key={group.title}>
                <p className={cn(head, 'px-3 pb-1 pt-2')}>{group.title}</p>
                {group.flows.map((item) => (
                  <button key={item.id} type="button" onClick={() => pick(item.id)} aria-current={item.id === flow?.id ? 'true' : undefined}
                    className={cn('block w-full border-l-[3px] border-transparent px-3 py-2 text-left hover:bg-surface-1', item.id === flow?.id && 'border-accent bg-surface-1')}>
                    <span className="flex items-center gap-1.5 font-mono text-[0.68rem] font-semibold text-secondary-foreground">{item.id}{item.changed && <span className="size-[7px] rounded-full bg-status-conflict" title="changed since the previous version" />}</span>
                    <span className="mb-1 mt-px block text-[0.78rem] text-foreground">{item.title}</span>
                    <span className="flex flex-wrap gap-1">{flowTickets(item, draft.tickets).map((key) => <span key={key} className={cn(chip, draft.tickets.some((ticket) => ticket.key === key) ? TONE.note : TONE.none)}>{key}</span>)}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="min-w-0 p-3">
            {flow ? (
              <div className="grid min-w-0 gap-3">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <h3 className="min-w-0 text-pretty font-display text-base font-bold"><span className="mr-2 font-mono text-[0.8rem] text-muted-foreground">{flow.id}</span>{flow.title}</h3>
                  {flow.changed && <span className={cn(chip, TONE.conflict)}>changed</span>}
                </div>
                {flow.info.length > 0 && (
                  <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[0.78rem] text-secondary-foreground">
                    {flow.info.map((line, index) => (
                      <React.Fragment key={index}>
                        <dt className={head}>{INFO_LABELS[index] ?? `${index + 1}`}</dt>
                        <dd className="min-w-0 text-pretty">{line}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
                {board?.htmlUrl && <ScaledFrame src={htmlOf(board.htmlUrl, flow.id)!} title={`Storyboard ${flow.id}`} />}
                <ol className="grid min-w-0 auto-cols-[minmax(11rem,14rem)] grid-flow-col gap-2 overflow-x-auto pb-1" aria-label="Frames">
                  {flow.frames.map((frame) => (
                    <li key={frame.index}>
                      <button type="button" disabled={!frame.changed} onClick={() => setCompare(frame.index)} title={frame.changed ? 'Compare with the previous version' : undefined}
                        className={cn('h-full w-full rounded-md border bg-surface-1 px-2.5 py-2 text-left text-[0.76rem] disabled:cursor-default', frame.changed ? 'border-status-conflict' : 'border-border', compare === frame.index && 'ring-1 ring-status-conflict')}>
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[0.66rem] font-semibold text-muted-foreground">{frame.index + 1}/{flow.frames.length}</span>
                          {frame.changed && <span className={cn(chip, TONE.conflict)}>changed</span>}
                        </span>
                        <span className="mt-1 block text-foreground">{frame.title}</span>
                        {frame.step && <span className="mt-0.5 block text-status-conflict">{frame.index + 1}. {frame.step}</span>}
                      </button>
                    </li>
                  ))}
                </ol>
                {compared && (
                  <section aria-label="Compare versions" className="grid min-w-0 gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={head}>Frame {compared.index + 1}/{flow.frames.length} · {compared.title}</p>
                      <Button size="sm" variant="ghost" onClick={() => setCompare(null)}>Close compare</Button>
                    </div>
                    <div className="grid min-w-0 grid-cols-2 gap-3 max-[760px]:grid-cols-[minmax(0,1fr)]">
                      <div className="min-w-0">
                        <p className="mb-1 font-mono text-[0.68rem] text-muted-foreground">{versionLabel(board?.previous ?? null)}</p>
                        {board?.previousHtmlUrl ? <ScaledFrame src={htmlOf(board.previousHtmlUrl, flow.id)!} title={`Previous ${flow.id}`} /> : <p className="text-[0.76rem] text-muted-foreground">No previous version saved.</p>}
                      </div>
                      <div className="min-w-0">
                        <p className="mb-1 font-mono text-[0.68rem] text-status-conflict">{versionLabel(board?.version ?? null)} · changed</p>
                        {board?.htmlUrl && <ScaledFrame src={htmlOf(board.htmlUrl, flow.id)!} title={`Newest ${flow.id}`} />}
                      </div>
                    </div>
                  </section>
                )}
                <h4 className={head}>Tickets in this flow</h4>
                {flowTickets(flow, draft.tickets).length
                  ? <TicketRows keys={flowTickets(flow, draft.tickets)} flow={flow} draft={draft} busy={working} onDecide={onDecide} />
                  : <p className="text-[0.76rem] text-muted-foreground">This flow lists no ticket.</p>}
              </div>
            ) : <p className="text-[0.78rem] text-muted-foreground">Pick a flow.</p>}
          </div>
        </div>
      )}
    </section>
  );
};
