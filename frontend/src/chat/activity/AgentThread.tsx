import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Repeat } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Markdown } from '../Markdown';
import { agentTask, agentType, durationOf, formatDuration, type ChatActivity } from './activity';
import { StatusIcon } from './ActivityRow';
import type { DetailStore } from './detailStore';
import { AgentAvatar, FoldedList, LiveDuration, MessageShell, TranscriptRow } from './TranscriptParts';
import { agentDetail, agentLook, descendantsOf, shortAgent, threadMessages, toolArg, toolName, treeStats, type ThreadPart } from './transcript';
import type { Checkpoint } from '../checkpoints';
import { CheckpointRoundRow } from '../CheckpointCard';
import { fixLoops, foldLoops, type FixLoop, type LoopPart } from '../fixLoops';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const AgentName: React.FC<{ name: string }> = ({ name }) => <span className="font-bold" style={{ color: agentLook(name).color }}>@{agentType(name)}</span>;

/** The newest running step under an agent, with the agent doing it, so a running thread shows its progress without being opened. */
const LiveStep: React.FC<{ rows: readonly ChatActivity[]; now: number }> = ({ rows, now }) => {
  const steps = rows.filter((row) => (row.kind === 'tool' || row.kind === 'skill') && row.status === 'running');
  const step = steps.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  if (!step) return null;
  const owner = rows.find((row) => row.eventId === step.parentId);
  return (
    <p className="mt-1 flex min-w-0 gap-2 font-mono text-[0.7rem] text-muted-foreground">
      <span aria-hidden="true" className="flex-none text-status-open">◐</span>
      <span className="min-w-0 truncate">{owner && <>{agentType(owner.name)} · </>}<b className="text-foreground">{toolName(step)}</b>({toolArg(step)})</span>
      <span className="ml-auto flex-none"><LiveDuration event={step} now={now} /></span>
    </p>
  );
};

/** Workers, steps, state and time of a thread on one line; the whole line opens it. */
const ThreadBar: React.FC<{ event: ChatActivity; rows: readonly ChatActivity[]; now: number; open: boolean; onClick: () => void; label: string }> = ({ event, rows, now, open, onClick, label }) => {
  const stats = treeStats(rows);
  const elapsed = durationOf(event, now);
  return (
    <button type="button" aria-expanded={open} onClick={onClick} className={cn('mt-1.5 flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xs px-2 py-1 text-left text-[0.76rem] text-secondary-foreground hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-[900px]:min-h-11', open && 'bg-accent-dim')}>
      {stats.types.length > 0 && <span className="flex pr-1">{stats.types.slice(0, 5).map((type) => <AgentAvatar key={type} name={type} small className="-mr-1 ring-2 ring-surface-0" />)}</span>}
      {stats.workers > 0 && <b className="text-foreground">{plural(stats.workers, 'worker')}</b>}
      <span>{plural(stats.steps, 'step')}</span>
      <span className="inline-flex items-center gap-1"><StatusIcon status={event.status} size={11} />{elapsed !== null && <span className="tabular-nums">{formatDuration(elapsed)}</span>}</span>
      <span className="ml-auto inline-flex items-center gap-0.5 text-status-open">{label}<ChevronRight size={12} aria-hidden="true" /></span>
    </button>
  );
};

interface CallProps {
  event: ChatActivity;
  /** Every row under the agent, at any depth. */
  rows: readonly ChatActivity[];
  store: DetailStore;
  now: number;
  /** The open thread is this agent or one of its workers. */
  open: boolean;
  /** Opens the thread beside the conversation. Without it the thread opens in place. */
  onOpen?: (eventId: string) => void;
}

/** The lead calling an agent, as a message: who it called, the task, and the thread line under it. */
export const AgentCall: React.FC<CallProps> = ({ event, rows, store, now, open, onOpen }) => {
  const [inline, setInline] = useState(false);
  const shown = onOpen ? open : inline;
  return (
    <MessageShell name="lead" at={event.startedAt} title={<>lead → <AgentName name={event.name} /></>} className={cn(onOpen && open && '-ml-3 rounded-r-sm border-l-[3px] border-accent bg-gradient-to-r from-accent-dim to-transparent pl-2')}>
      <div className="rounded-sm border border-border bg-surface-1 px-2.5 pt-2 pb-1">
        <p className="line-clamp-2 text-[0.8rem] text-secondary-foreground [overflow-wrap:anywhere]">{agentTask(event)}</p>
        <ThreadBar event={event} rows={rows} now={now} open={shown} label={shown ? 'Thread open' : 'Open thread'} onClick={() => (onOpen ? onOpen(event.eventId) : setInline((current) => !current))} />
      </div>
      {event.status === 'running' && <LiveStep rows={rows} now={now} />}
      {!onOpen && inline && <ul className="mt-2 flex min-w-0 flex-col gap-3 border-l border-border pl-3"><AgentThreadBody agent={event} rows={rows} parentName="lead" store={store} now={now} /></ul>}
    </MessageShell>
  );
};

/** A worker an agent called, as one line in that agent's thread. */
const CallLine: React.FC<{ event: ChatActivity; rows: readonly ChatActivity[]; store: DetailStore; now: number; onOpen?: (eventId: string) => void; parentName: string; round?: number }> = ({ event, rows, store, now, onOpen, parentName, round }) => {
  const [inline, setInline] = useState(false);
  const own = descendantsOf(rows, event.eventId);
  const stats = treeStats(own);
  const elapsed = durationOf(event, now);
  const running = event.status === 'running';
  return (
    <li className="min-w-0">
      <button type="button" aria-expanded={onOpen ? undefined : inline} onClick={() => (onOpen ? onOpen(event.eventId) : setInline((current) => !current))} className={cn('-mx-2 flex w-[calc(100%+1rem)] min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-xs border-t border-border px-2 py-1.5 text-left font-body text-[0.78rem] text-secondary-foreground hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-[900px]:min-h-11', running && 'border-transparent bg-status-open-bg')}>
        <AgentAvatar name={event.name} small className="self-center" />
        <AgentName name={event.name} />
        <span className="min-w-0">{round ? `round ${round}` : agentTask(event)}</span>
        <span className="inline-flex items-center gap-1 font-mono text-[0.68rem]"><StatusIcon status={event.status} size={11} />{plural(stats.steps, 'step')}{elapsed !== null && <> · {formatDuration(elapsed)}</>}</span>
        <ChevronRight size={12} aria-hidden="true" className="ml-auto self-center text-status-open" />
        {running && <span className="basis-full"><LiveStep rows={own} now={now} /></span>}
      </button>
      {!onOpen && inline && <ul className="mt-2 flex min-w-0 flex-col gap-3 border-l border-border pl-3"><AgentThreadBody agent={event} rows={own} parentName={parentName} store={store} now={now} /></ul>}
    </li>
  );
};

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Worker and verifier runs on one task, boxed as "Fix loop T1 · 3 rounds", each failed round's line under its verifier. */
export const FixLoopBox: React.FC<{ loop: FixLoop; parts: readonly ThreadPart[]; render: (part: ThreadPart, round?: number) => React.ReactNode }> = ({ loop, parts, render }) => {
  const calls = parts.filter((part) => part.kind === 'call').map((part) => part.event);
  const first = calls[0];
  const last = calls[calls.length - 1];
  const running = calls.some((call) => call.status === 'running');
  return (
    <li className="min-w-0">
      <div className="flex min-w-0 flex-col gap-1.5 rounded-sm border border-status-warn/40 px-2.5 py-2" role="group" aria-label={`Fix loop ${loop.task}`}>
        <p className="flex items-center gap-1.5 text-[0.76rem] font-semibold text-status-warn">
          <Repeat size={13} aria-hidden="true" className="flex-none" />
          Fix loop {loop.task} · {plural(loop.rounds, 'round')}
          {first && <span className="ml-auto font-mono text-[0.66rem] font-normal text-muted-foreground">{clock(first.startedAt)}–{running || !last?.endedAt ? 'now' : clock(last.endedAt)}</span>}
        </p>
        <ul className="flex min-w-0 flex-col gap-1">
          {parts.map((part) => (
            <React.Fragment key={part.event.eventId}>
              {render(part, part.kind === 'call' ? loop.roundOf.get(part.event.eventId) : undefined)}
              {part.kind === 'call' && loop.notes.get(part.event.eventId)?.map((checkpoint) => <CheckpointRoundRow key={`cp-${checkpoint.id}`} checkpoint={checkpoint} />)}
            </React.Fragment>
          ))}
        </ul>
      </div>
    </li>
  );
};

interface BodyProps {
  agent: ChatActivity;
  /** Rows under the agent; the agent row itself may be among them. */
  rows: readonly ChatActivity[];
  parentName: string;
  store: DetailStore;
  now: number;
  onOpenChild?: (eventId: string) => void;
  /** The ticket's checkpoints; the failed rounds go under their verifier inside the fix loop. */
  checkpoints?: readonly Checkpoint[];
}

/** One agent's thread, as Claude Code reads a subagent: the task it was given, every step it took, and what it reported back. */
export const AgentThreadBody: React.FC<BodyProps> = ({ agent, rows, parentName, store, now, onOpenChild, checkpoints = [] }) => {
  const entry = useSyncExternalStore(store.subscribe, () => store.get(agent.id));
  const version = `${agent.status}:${agent.seq}`;
  useEffect(() => {
    if (agent.hasDetail) store.load(agent.id, version);
  }, [store, agent.id, agent.hasDetail, version]);
  const [fullPrompt, setFullPrompt] = useState(false);
  const detail = agentDetail(entry.text);
  const own = descendantsOf(rows, agent.eventId);
  const direct = treeStats(own.filter((row) => row.parentId === agent.eventId));
  const loops = fixLoops(own.filter((row) => row.parentId === agent.eventId && row.kind === 'agent'), checkpoints);
  const messages = foldLoops(threadMessages(own, agent.eventId), loops);
  const running = agent.status === 'running';
  const elapsed = durationOf(agent, now);
  const prompt = detail.prompt || agentTask(agent);
  const done = [
    plural(detail.tools ?? direct.steps, 'tool use'),
    detail.tokens !== null ? `${(detail.tokens / 1000).toFixed(1)}k tokens` : null,
    detail.durationMs !== null ? formatDuration(detail.durationMs) : elapsed !== null ? formatDuration(elapsed) : null,
  ].filter(Boolean).join(' · ');
  const renderOne = (part: ThreadPart, round?: number) => (part.kind === 'call'
    ? <CallLine key={part.event.eventId} event={part.event} rows={own} store={store} now={now} onOpen={onOpenChild} parentName={agent.name} round={round} />
    : <TranscriptRow key={part.event.eventId} event={part.event} store={store} now={now} />);
  const renderPart = (part: LoopPart<ThreadPart>) => (part.kind === 'loop'
    ? <FixLoopBox key={`loop-${part.loop.calls[0]}`} loop={part.loop} parts={part.parts} render={renderOne} />
    : renderOne(part));
  return (
    <>
      <MessageShell name={parentName} at={agent.startedAt} title={<>{shortAgent(parentName)} → <AgentName name={agent.name} /></>}>
        <p className={cn('whitespace-pre-wrap text-[0.8rem] text-secondary-foreground [overflow-wrap:anywhere]', !fullPrompt && 'line-clamp-6')}>{prompt}</p>
        {prompt.length > 280 && <button type="button" className="text-[0.74rem] text-status-open hover:underline max-[900px]:min-h-11" onClick={() => setFullPrompt((current) => !current)}>{fullPrompt ? 'Show less' : 'Show all'}</button>}
      </MessageShell>
      <li className="flex items-center gap-2 font-mono text-[0.64rem] text-muted-foreground before:flex-1 before:border-t before:border-border after:flex-1 after:border-t after:border-border">
        {[plural(direct.steps, 'step'), direct.workers ? plural(direct.workers, 'worker') : null, direct.failed ? `${direct.failed} failed` : null, direct.denied ? `${direct.denied} blocked` : null].filter(Boolean).join(' · ')}
      </li>
      {messages.map((message) => (
        <MessageShell key={message.key} name={agent.name} at={message.at}>
          <FoldedList parts={message.parts} isStep={(part) => part.kind === 'event'} render={renderPart} />
        </MessageShell>
      ))}
      {running ? (
        <li className="flex items-center gap-1.5 pl-10 text-[0.74rem] text-muted-foreground" role="status">
          <span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((dot) => <i key={dot} className="size-1.5 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none" style={{ animationDelay: `${dot * 200}ms` }} />)}</span>
          {agentType(agent.name)} is working
        </li>
      ) : (
        <MessageShell name={agent.name} at={agent.endedAt ?? agent.startedAt} title={<>{agentType(agent.name)} → @{shortAgent(parentName)} <span className="rounded-[4px] border border-[#e08a5c]/50 px-1 font-mono text-[0.58rem] uppercase tracking-wider text-[#e08a5c]">report</span></>}>
          {detail.report ? <div className="text-[0.82rem] leading-relaxed"><Markdown text={detail.report} /></div> : <p className="text-[0.78rem] text-muted-foreground">{entry.state === 'ready' || !agent.hasDetail ? 'This run did not keep the report the agent sent back.' : 'Loading the report...'}</p>}
          <p className="mt-1 flex gap-2 font-mono text-[0.72rem] text-muted-foreground"><span aria-hidden="true">⎿</span><span>{agent.status === 'ok' ? `Done (${done})` : `${agent.status === 'error' ? 'Failed' : agent.status === 'denied' ? 'Blocked' : 'Stopped'} (${done})`}</span></p>
        </MessageShell>
      )}
    </>
  );
};
