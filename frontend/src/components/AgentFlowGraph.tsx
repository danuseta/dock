import React, { useEffect, useState } from 'react';
import { FLOW_RAIL, type AgentRun, type AgentTimeline, type TimelineAgent } from '../agents/runs';
import { SHOWN_ROUNDS, inVisit, railVisits, shortDuration, visitLength, type RailVisit } from '../agents/rail';
import { formatDuration } from '../chat/activity/activity';
import { useNow } from '../chat/activity/useNow';
import { cn } from '../lib/cn';
import '../agents/flow/flow.css';
import { ThinkingColumn } from '../agents/ThinkingColumn';

const NAMES_Y = 50;
const FIRST_ROW_Y = 90;
const ROW_HEIGHT = 76;
const LEAF_ROW = 5;
const LEAF_ROW_HEIGHT = 86;
const MAX_AC_CHIPS = 8;
const DONE_STROKE = 'oklch(0.72 0.12 150)';
const AHEAD_STROKE = 'oklch(0.30 0 0)';
const BACK_STROKE = 'oklch(0.65 0.16 25)';

const stateLabel: Record<string, string> = { active: 'working', waiting: 'waiting on you', idle: 'idle', done: 'done' };

const footerText = (agent: TimelineAgent, supervising?: boolean) => {
  if (agent.tool) return agent.tool;
  if (supervising && agent.state === 'active') return 'supervising';
  if (agent.state === 'done' && agent.since && agent.until) return formatDuration(new Date(agent.until).getTime() - new Date(agent.since).getTime());
  return stateLabel[agent.state] || agent.state;
};

const AgentBox: React.FC<{ agent: TimelineAgent; x: number; y: number; small: boolean; supervising?: boolean; picked?: boolean; onPick?: (name: string) => void }> = ({ agent, x, y, small, supervising, picked, onPick }) => (
  <div
    className={cn('dock-flow-node dock-flow-agent', `is-${agent.state}`, small && 'is-small', onPick && 'cursor-pointer', picked && 'is-picked-agent')}
    style={{ left: `${x / 10}%`, top: y }}
    role={onPick ? 'button' : undefined}
    tabIndex={onPick ? 0 : undefined}
    aria-pressed={onPick ? Boolean(picked) : undefined}
    aria-label={onPick ? `Show only ${agent.name} in Thinking` : undefined}
    onClick={onPick ? () => onPick(agent.name) : undefined}
    onKeyDown={onPick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(agent.name); } } : undefined}
  >
    <header><i aria-hidden="true" /><span>{agent.name}</span></header>
    <p>{agent.detail || (agent.parentId ? 'team member' : 'main session')}</p>
    <footer><span>{footerText(agent, supervising)}</span><span>{agent.tools} {agent.tools === 1 ? 'tool' : 'tools'}</span></footer>
  </div>
);

interface AgentFlowGraphProps { run: AgentRun; timeline: AgentTimeline }

/**
 * A live picture of one ticket's run, drawn from the stage, gate and tool-call
 * events the laptop already reports. No session content is involved.
 * The rail has one row per round; a stop the run visited can be picked to show the team that worked there.
 */
export const AgentFlowGraph: React.FC<AgentFlowGraphProps> = ({ run, timeline }) => {
  const [picked, setPicked] = useState<number | null>(null);
  const [allRounds, setAllRounds] = useState(false);
  const [agentPick, setAgentPick] = useState<string | null>(null);
  const pickAgent = (name: string) => setAgentPick((current) => (current === name ? null : name));
  // A cron run never stops at GATE 1, so its rail starts at Plan.
  const skip = timeline.hasGate ? 0 : 1;
  const stops = FLOW_RAIL.slice(skip);
  const stageX = (index: number) => 90 + Math.min(Math.max(0, index - skip), stops.length - 1) * (820 / (stops.length - 1));
  const stopName = (index: number) => {
    const stop = FLOW_RAIL[Math.min(index, FLOW_RAIL.length - 1)];
    return run.kind === 'review' ? stop.review : stop.name;
  };
  const current = timeline.stageIndex;
  const finished = current >= FLOW_RAIL.length;
  const visits = railVisits(timeline, finished);
  const last = visits[visits.length - 1];

  // Another ticket, or the run reaching a new stop, brings the graph back to where the run is now.
  useEffect(() => setPicked(null), [run.key, visits.length]);

  const shown = picked != null && visits[picked] ? visits[picked] : last;
  const looking = shown !== last;
  const now = useNow(!finished);

  const firstRound = allRounds ? 1 : Math.max(1, last.round - SHOWN_ROUNDS + 1);
  const rounds = Array.from({ length: last.round - firstRound + 1 }, (_, index) => firstRound + index);
  const rowY = (round: number) => FIRST_ROW_Y + (round - firstRound) * ROW_HEIGHT;
  const rowVisits = visits.filter((visit) => visit.round >= firstRound);
  const lastY = rowY(last.round);
  const ahead = finished ? [] : FLOW_RAIL.map((_, index) => index).filter((index) => index > last.stageIndex && index >= skip);
  const stopNote: Partial<Record<(typeof FLOW_RAIL)[number]['id'], string | null>> = {
    work: current === 2 ? run.note : null,
    final: run.rounds ? `round ${run.rounds.used}/${run.rounds.max}` : null,
    pr: run.draft ? 'draft' : null,
  };
  const noteAt = (index: number) => stopNote[FLOW_RAIL[Math.min(index, FLOW_RAIL.length - 1)].id] || null;
  const metaOf = (visit: RailVisit) => {
    const length = visitLength(visit, now);
    const team = visit.agents.length - 1;
    return [length != null ? shortDuration(length) : null, team > 0 ? `${team} ${team === 1 ? 'agent' : 'agents'}` : null].filter(Boolean).join(' · ');
  };

  // The graph under the rail: the team of the picked visit, hanging from it.
  const agents = shown.agents;
  const rootY = lastY + 132;
  const childY = rootY + 100;
  const leafTop = childY + 100;
  const root = agents.find((agent) => !agent.parentId) || agents[0];
  const rootX = Math.max(110, Math.min(890, stageX(shown.stageIndex)));
  // Two rows under the lead: whoever it spawned, then whoever they spawned.
  const children = agents.filter((agent) => agent.parentId && agent.parentId === root?.id);
  const leaves = children.flatMap((child) => agents.filter((agent) => agent.parentId === child.id));
  const spread = (count: number, centre: number) => {
    const span = count > 3 ? Math.min(200, 810 / Math.max(1, count - 1)) : 250;
    const first = Math.max(95, Math.min(905 - (count - 1) * span, centre - ((count - 1) * span) / 2));
    return (index: number) => first + index * span;
  };
  const small = children.length > 3 || leaves.length > 3;
  const childX = spread(children.length, rootX);
  const leafCentre = children.length ? childX((children.length - 1) / 2) : rootX;
  const leafX = (index: number) => {
    const row = Math.floor(index / LEAF_ROW);
    return spread(Math.min(LEAF_ROW, leaves.length - row * LEAF_ROW), leafCentre)(index % LEAF_ROW);
  };
  const leafY = (index: number) => leafTop + Math.floor(index / LEAF_ROW) * LEAF_ROW_HEIGHT;
  const leafRows = Math.max(1, Math.ceil(leaves.length / LEAF_ROW));
  // The graph ends under its lowest row: the lead alone, the agents it spawned, or the last row of theirs.
  const lowestY = leaves.length > 0 ? leafTop + (leafRows - 1) * LEAF_ROW_HEIGHT : children.length > 0 ? childY : rootY;
  const height = lowestY + 144;
  const parentX = (agent: TimelineAgent) => childX(Math.max(0, children.findIndex((child) => child.id === agent.parentId)));
  const maxBucket = Math.max(3, ...timeline.buckets.map((bucket) => bucket.n));
  const busy = root?.state === 'active' && !looking;
  const shownWhen = [shown.from, shown.to].every(Boolean)
    ? `${new Date(shown.from as string).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}–${new Date(shown.to as string).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : null;

  return (
    <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] max-[1120px]:grid-cols-1">
      <div className="dock-flow-wrap">
        <div className="dock-flow" style={{ height }} role="group" aria-label={`Flow of ${run.key}: stage ${stopName(current)}, round ${last.round}, ${timeline.agents.length} agents, ${timeline.totalTools} tool calls`}>
          <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {rounds.map((round) => {
              const row = rowVisits.filter((visit) => visit.round === round);
              if (row.length === 0) return null;
              const y = rowY(round);
              return <line key={round} x1={stageX(row[0].stageIndex)} y1={y} x2={stageX(row[row.length - 1].stageIndex)} y2={y} stroke={DONE_STROKE} strokeWidth="2" />;
            })}
            {ahead.length > 0 && <line x1={stageX(last.stageIndex)} y1={lastY} x2={stageX(ahead[ahead.length - 1])} y2={lastY} stroke={AHEAD_STROKE} strokeWidth="2" />}
            {rowVisits.filter((visit) => visit.state === 'returned').map((visit) => {
              const next = visits[visit.index + 1];
              const [x1, y1, x2, y2] = [stageX(visit.stageIndex), rowY(visit.round), stageX(next.stageIndex), rowY(next.round)];
              return <path key={visit.index} d={`M ${x1} ${y1 + 14} C ${x1} ${y1 + 46}, ${x2} ${y2 - 46}, ${x2} ${y2 - 14}`} fill="none" stroke={BACK_STROKE} strokeWidth="1.5" strokeDasharray="5 4" />;
            })}
            {root && <line x1={stageX(shown.stageIndex)} y1={lastY + 34} x2={rootX} y2={rootY - 34} stroke="oklch(0.36 0 0)" strokeWidth="1.5" />}
            {children.map((child, index) => (
              <path
                key={child.id}
                className={child.state === 'active' ? 'dock-flow-dash' : undefined}
                d={`M ${rootX} ${rootY + 34} C ${rootX} ${rootY + 62}, ${childX(index)} ${childY - 62}, ${childX(index)} ${childY - 34}`}
                fill="none"
                stroke={child.state === 'active' ? 'oklch(0.75 0.11 220)' : 'oklch(0.36 0 0)'}
                strokeWidth="1.5"
              />
            ))}
            {leaves.map((leaf, index) => (
              <path
                key={leaf.id}
                className={leaf.state === 'active' ? 'dock-flow-dash' : undefined}
                d={`M ${parentX(leaf)} ${childY + 34} C ${parentX(leaf)} ${childY + 62}, ${leafX(index)} ${leafY(index) - 62}, ${leafX(index)} ${leafY(index) - 34}`}
                fill="none"
                stroke={leaf.state === 'active' ? 'oklch(0.75 0.11 220)' : 'oklch(0.36 0 0)'}
                strokeWidth="1.5"
              />
            ))}
          </svg>

          <div className="dock-flow-head">
            <span className="rounded-xs border border-accent/30 bg-accent-dim px-[9px] py-0.5 font-mono text-[0.8rem] font-extrabold text-accent">{run.key}</span>
            <span className={cn('dock-flow-live', !busy && 'is-quiet')}><i aria-hidden="true" />{looking ? 'HISTORY' : busy ? 'LIVE' : finished ? 'DONE' : 'QUIET'}</span>
            {looking && (
              <span className="dock-flow-viewing">
                Showing <b>{stopName(shown.stageIndex)} · R{shown.round}</b>{shownWhen && ` ${shownWhen}`}
                <button type="button" onClick={() => setPicked(null)}>Back to now</button>
              </span>
            )}
          </div>

          {stops.map((_, position) => {
            const index = position + skip;
            return <span key={index} className="dock-flow-node dock-flow-name" style={{ left: `${stageX(index) / 10}%`, top: NAMES_Y }}>{stopName(index)}</span>;
          })}

          {(rounds.length > 1 || firstRound > 1) && rounds.map((round) => (
            <span key={round} className="dock-flow-node dock-flow-rowname" style={{ left: '3%', top: rowY(round) }}>R{round}</span>
          ))}
          {last.round > SHOWN_ROUNDS && (
            <button type="button" className="dock-flow-node dock-flow-fold" style={{ left: '3%', top: NAMES_Y }} aria-expanded={allRounds} aria-label={allRounds ? 'Fold the older rounds' : 'Show the older rounds'} onClick={() => setAllRounds((all) => !all)}>
              {allRounds ? 'Fold' : firstRound > 2 ? `R1–R${firstRound - 1}` : 'R1'}
            </button>
          )}

          {rowVisits.map((visit) => {
            const isLast = visit === last;
            const meta = metaOf(visit);
            const note = isLast ? noteAt(visit.stageIndex) : null;
            return (
              <button
                key={visit.index}
                type="button"
                className={cn('dock-flow-node dock-flow-visit', `is-${visit.state}`, visit === shown && 'is-picked')}
                style={{ left: `${stageX(visit.stageIndex) / 10}%`, top: rowY(visit.round) }}
                aria-pressed={visit === shown}
                aria-label={`${stopName(visit.stageIndex)}, round ${visit.round}${meta ? `, ${meta}` : ''}. Show the team that worked there.`}
                onClick={() => setPicked(isLast ? null : visit.index)}
              >
                <b>{visit.state === 'done' ? '✓' : visit.state === 'returned' ? '↩' : visit.stageIndex - skip + 1}</b>
                {meta && <small>{meta}</small>}
                {note && <small className="is-note" title={note}>{note}</small>}
              </button>
            );
          })}

          {ahead.map((index) => {
            const note = noteAt(index);
            return (
              <span key={index} className="dock-flow-node dock-flow-visit is-ahead" style={{ left: `${stageX(index) / 10}%`, top: lastY }}>
                <b>{index - skip + 1}</b>
                {note && <small className="is-note" title={note}>{note}</small>}
              </span>
            );
          })}

          {timeline.gates.map((gate) => {
            const visit = rowVisits.find((item) => item.stageIndex === gate.stageIndex && inVisit(gate.at, item));
            if (!visit) return null;
            return <span key={gate.id} className={cn('dock-flow-node dock-flow-gate', gate.state === 'waiting' && 'is-waiting')} style={{ left: `${stageX(visit.stageIndex) / 10}%`, top: rowY(visit.round) }} title={`${gate.state === 'waiting' ? 'Waiting on you' : 'Gate opened'}: ${gate.text}`} />;
          })}

          {run.ac.length > 0 && (
            <div className="dock-flow-node dock-flow-ac" style={{ left: `${stageX(4) / 10}%`, top: lastY + 44 }}>
              <small>AC {run.acPassed}/{run.acTotal}</small>
              <div>
                {run.ac.slice(0, MAX_AC_CHIPS).map((item) => <span key={item.n} className={item.state === 'PASS' ? 'is-pass' : item.state === 'FAIL' ? 'is-fail' : undefined}>{item.n}</span>)}
                {run.ac.length > MAX_AC_CHIPS && <span>+{run.ac.length - MAX_AC_CHIPS}</span>}
              </div>
            </div>
          )}

          {root && <AgentBox agent={root} x={rootX} y={rootY} small={false} picked={agentPick === root.name} onPick={pickAgent} />}
          {children.map((child, index) => <AgentBox key={child.id} agent={child} x={childX(index)} y={childY} small={small} supervising={leaves.some((leaf) => leaf.parentId === child.id && leaf.state === 'active')} picked={agentPick === child.name} onPick={pickAgent} />)}
          {leaves.map((leaf, index) => <AgentBox key={leaf.id} agent={leaf} x={leafX(index)} y={leafY(index)} small={small} picked={agentPick === leaf.name} onPick={pickAgent} />)}

          <div className="dock-flow-strip">
            <div><span>tool activity · 5 s per bar</span><span>{timeline.totalTools} tool calls</span></div>
            <div className="dock-flow-bars" aria-hidden="true">
              {timeline.buckets.map((bucket, index) => (
                <i key={index} className={bucket.gate ? 'is-gate' : index === timeline.buckets.length - 1 ? 'is-now' : undefined} style={{ height: `${bucket.gate ? 100 : Math.max(4, (bucket.n / maxBucket) * 100)}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <ThinkingColumn
        runKey={run.key}
        review={run.kind === 'review'}
        visit={looking ? { stageIndex: shown.stageIndex, round: shown.round } : null}
        agent={agentPick}
        onClearVisit={() => setPicked(null)}
        onClearAgent={() => setAgentPick(null)}
        maxHeight={height}
      />
    </div>
  );
};
