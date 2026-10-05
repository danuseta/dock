import React from 'react';
import { FLOW_RAIL, stageName, type AgentRun, type AgentTimeline, type TimelineAgent } from '../agents/runs';
import { cn } from '../lib/cn';
import '../agents/flow/flow.css';

const stageX = (index: number) => 90 + Math.min(index, FLOW_RAIL.length - 1) * 164;
const RAIL_Y = 92;
const ROOT_Y = 196;
const CHILD_Y = 296;
const LEAF_Y = 396;
const LEAF_ROW = 5;
const LEAF_ROW_HEIGHT = 86;
const MAX_AC_CHIPS = 8;

const stateLabel: Record<string, string> = { active: 'working', waiting: 'waiting on you', idle: 'idle', done: 'done' };
const logTone: Record<string, string> = { stage: 'text-accent', gate: 'text-amber-200', ok: 'text-status-merged', tool: 'text-[oklch(0.75_0.11_220)]' };

const AgentBox: React.FC<{ agent: TimelineAgent; x: number; y: number; small: boolean; supervising?: boolean }> = ({ agent, x, y, small, supervising }) => (
  <div className={cn('dock-flow-node dock-flow-agent', `is-${agent.state}`, small && 'is-small')} style={{ left: `${x / 10}%`, top: y }}>
    <header><i aria-hidden="true" /><span>{agent.name}</span></header>
    <p>{agent.detail || (agent.parentId ? 'team member' : 'main session')}</p>
    <footer><span>{agent.tool || (supervising && agent.state === 'active' ? 'supervising' : stateLabel[agent.state] || agent.state)}</span><span>{agent.tools} {agent.tools === 1 ? 'tool' : 'tools'}</span></footer>
  </div>
);

interface AgentFlowGraphProps { run: AgentRun; timeline: AgentTimeline }

/**
 * A live picture of one ticket's run, drawn from the stage, gate and tool-call
 * events the laptop already reports. No session content is involved.
 */
export const AgentFlowGraph: React.FC<AgentFlowGraphProps> = ({ run, timeline }) => {
  const current = timeline.stageIndex;
  const finished = current >= FLOW_RAIL.length;
  const root = timeline.agents.find((agent) => !agent.parentId) || timeline.agents[0];
  const rootX = Math.max(110, Math.min(890, stageX(current)));
  // Two rows under the lead: whoever it spawned, then whoever they spawned.
  const children = timeline.agents.filter((agent) => agent.parentId && agent.parentId === root?.id);
  const leaves = children.flatMap((child) => timeline.agents.filter((agent) => agent.parentId === child.id));
  const spread = (count: number, centre: number) => {
    const span = count > 3 ? Math.min(172, 810 / Math.max(1, count - 1)) : 190;
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
  const leafY = (index: number) => LEAF_Y + Math.floor(index / LEAF_ROW) * LEAF_ROW_HEIGHT;
  const leafRows = Math.max(1, Math.ceil(leaves.length / LEAF_ROW));
  const height = 540 + (leafRows - 1) * LEAF_ROW_HEIGHT;
  const parentX = (agent: TimelineAgent) => childX(Math.max(0, children.findIndex((child) => child.id === agent.parentId)));
  const gatesAt = new Map<number, number>();
  const maxBucket = Math.max(3, ...timeline.buckets.map((bucket) => bucket.n));
  const busy = root?.state === 'active';
  const hasLoop = timeline.loopFrom != null && timeline.loopTo != null && !finished;
  const loopStart = hasLoop ? stageX(timeline.loopFrom as number) - 16 : 0;
  const loopEnd = hasLoop ? stageX(timeline.loopTo as number) + 16 : 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] max-[1120px]:grid-cols-1">
      <div className="dock-flow-wrap">
        <div className="dock-flow" style={{ height }} role="img" aria-label={`Flow of ${run.key}: stage ${stageName(FLOW_RAIL[Math.min(current, FLOW_RAIL.length - 1)].id, run.kind)}, ${timeline.agents.length} agents, ${timeline.totalTools} tool calls`}>
          <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
            <line x1={stageX(0)} y1={RAIL_Y} x2={stageX(5)} y2={RAIL_Y} stroke="oklch(0.30 0 0)" strokeWidth="2" />
            {current > 0 && <line x1={stageX(0)} y1={RAIL_Y} x2={stageX(current)} y2={RAIL_Y} stroke="oklch(0.72 0.12 150)" strokeWidth="2" />}
            {hasLoop && <path className="dock-flow-dash" d={`M ${loopStart} ${RAIL_Y - 16} C ${loopStart} ${RAIL_Y - 58}, ${loopEnd} ${RAIL_Y - 58}, ${loopEnd} ${RAIL_Y - 16}`} fill="none" stroke="oklch(0.80 0.12 85)" strokeWidth="1.5" />}
            {root && <line x1={stageX(current)} y1={RAIL_Y + 14} x2={rootX} y2={ROOT_Y - 34} stroke="oklch(0.36 0 0)" strokeWidth="1.5" />}
            {children.map((child, index) => (
              <path
                key={child.id}
                className={child.state === 'active' ? 'dock-flow-dash' : undefined}
                d={`M ${rootX} ${ROOT_Y + 34} C ${rootX} ${ROOT_Y + 62}, ${childX(index)} ${CHILD_Y - 62}, ${childX(index)} ${CHILD_Y - 34}`}
                fill="none"
                stroke={child.state === 'active' ? 'oklch(0.75 0.11 220)' : 'oklch(0.36 0 0)'}
                strokeWidth="1.5"
              />
            ))}
            {leaves.map((leaf, index) => (
              <path
                key={leaf.id}
                className={leaf.state === 'active' ? 'dock-flow-dash' : undefined}
                d={`M ${parentX(leaf)} ${CHILD_Y + 34} C ${parentX(leaf)} ${CHILD_Y + 62}, ${leafX(index)} ${leafY(index) - 62}, ${leafX(index)} ${leafY(index) - 34}`}
                fill="none"
                stroke={leaf.state === 'active' ? 'oklch(0.75 0.11 220)' : 'oklch(0.36 0 0)'}
                strokeWidth="1.5"
              />
            ))}
          </svg>

          <div className="dock-flow-head">
            <span className="rounded-xs border border-accent/30 bg-accent-dim px-[9px] py-0.5 font-mono text-[0.8rem] font-extrabold text-accent">{run.key}</span>
            <span className={cn('dock-flow-live', !busy && 'is-quiet')}><i aria-hidden="true" />{busy ? 'LIVE' : finished ? 'DONE' : 'QUIET'}</span>
            {timeline.round > 1 && <span className="dock-flow-round">ROUND {timeline.round}</span>}
          </div>

          {hasLoop && <div className="dock-flow-node dock-flow-loop" style={{ left: `${(loopStart + loopEnd) / 20}%`, top: RAIL_Y - 60 }}>sent back · round {timeline.round}</div>}

          {FLOW_RAIL.map((stage, index) => (
            <div
              key={stage.id}
              className={cn('dock-flow-node dock-flow-stage', index < current && 'is-done', index === current && 'is-now')}
              style={{ left: `${stageX(index) / 10}%`, top: RAIL_Y + 11, '--stage': stage.color } as React.CSSProperties}
            >
              <b>{index < current ? '✓' : index + 1}</b><span>{stageName(stage.id, run.kind)}</span>
            </div>
          ))}

          {timeline.gates.map((gate) => {
            const slot = gatesAt.get(gate.stageIndex) || 0;
            gatesAt.set(gate.stageIndex, slot + 1);
            const x = stageX(gate.stageIndex) + 46 + slot * 30;
            return <div key={gate.id} className={cn('dock-flow-node dock-flow-gate', gate.state === 'waiting' && 'is-waiting')} style={{ left: `${x / 10}%`, top: RAIL_Y }} title={`${gate.state === 'waiting' ? 'Waiting on you' : 'Gate opened'}: ${gate.text}`} />;
          })}

          {run.ac.length > 0 && (
            <div className="dock-flow-node dock-flow-ac" style={{ left: `${stageX(4) / 10}%`, top: RAIL_Y - 52 }}>
              <small>AC {run.acPassed}/{run.acTotal}</small>
              <div>
                {run.ac.slice(0, MAX_AC_CHIPS).map((item) => <span key={item.n} className={item.state === 'PASS' ? 'is-pass' : item.state === 'FAIL' ? 'is-fail' : undefined}>{item.n}</span>)}
                {run.ac.length > MAX_AC_CHIPS && <span>+{run.ac.length - MAX_AC_CHIPS}</span>}
              </div>
            </div>
          )}

          {root && <AgentBox agent={root} x={rootX} y={ROOT_Y} small={false} />}
          {children.map((child, index) => <AgentBox key={child.id} agent={child} x={childX(index)} y={CHILD_Y} small={small} supervising={leaves.some((leaf) => leaf.parentId === child.id && leaf.state === 'active')} />)}
          {leaves.map((leaf, index) => <AgentBox key={leaf.id} agent={leaf} x={leafX(index)} y={leafY(index)} small={small} />)}

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

      <div style={{ maxHeight: height }} className="overflow-y-auto border-l border-border bg-surface-0 p-4 max-[1120px]:max-h-none max-[1120px]:border-t max-[1120px]:border-l-0">
        <p className="mb-1 font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Latest events</p>
        {timeline.log.length === 0 && <p className="text-pretty text-sm text-muted-foreground">Nothing reported yet. Tool calls appear here once the hook on your laptop is running for this ticket.</p>}
        <ol className="flex flex-col">
          {timeline.log.map((entry, index) => (
            <li className="grid grid-cols-[58px_1fr] gap-2 border-b border-border py-[5px] text-[0.78rem] last:border-b-0" key={`${entry.at}-${index}`}>
              <time className="pt-px font-mono text-[0.68rem] text-muted-foreground tabular-nums" dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString('en-GB')}</time>
              <span className="min-w-0 break-words"><b className={cn('font-mono text-[0.72rem] font-bold', logTone[entry.kind])}>{entry.head}</b> {entry.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};
