import { FLOW_RAIL, type AgentTimeline, type TimelineVisit } from './runs';

/** The rail keeps the newest rounds on screen; older ones fold into one line above them. */
export const SHOWN_ROUNDS = 3;

export type VisitState = 'done' | 'returned' | 'now';
export interface RailVisit extends TimelineVisit { index: number; state: VisitState }

/**
 * The stops the run visited, each marked done, sent back (the last stop of a round the run left by going back),
 * or now (where an unfinished run is). A timeline from before visits were kept is one visit at the current stop.
 */
export function railVisits(timeline: AgentTimeline, finished: boolean): RailVisit[] {
  const visits: TimelineVisit[] = timeline.visits?.length
    ? timeline.visits
    : [{ stageIndex: Math.min(timeline.stageIndex, FLOW_RAIL.length - 1), round: 1, from: null, to: null, agents: timeline.agents }];
  return visits.map((visit, index) => {
    const last = index === visits.length - 1;
    const leftByGoingBack = !last && visits[index + 1].round !== visit.round;
    return { ...visit, index, state: last && !finished ? 'now' : leftByGoingBack ? 'returned' : 'done' };
  });
}

/** Whether a moment falls inside a visit; a visit without a start began with the run, one without an end is still on. */
export function inVisit(at: string, visit: Pick<TimelineVisit, 'from' | 'to'>): boolean {
  const time = new Date(at).getTime();
  return (!visit.from || time >= new Date(visit.from).getTime()) && (!visit.to || time < new Date(visit.to).getTime());
}

/** A rail-sized duration: 45s, 33m, 1h 05m. */
export function shortDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** How long the run stayed on a visit, in milliseconds, or null when its start is unknown. */
export function visitLength(visit: Pick<TimelineVisit, 'from' | 'to'>, now: number): number | null {
  if (!visit.from) return null;
  return (visit.to ? new Date(visit.to).getTime() : now) - new Date(visit.from).getTime();
}
