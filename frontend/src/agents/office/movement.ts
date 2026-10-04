// Ported from openclaw-office (MIT, (c) 2026 OpenClaw): src/lib/movement-animator.ts.
// planWalkPath, pathLength, calculateWalkDuration and interpolatePathPosition are
// the original functions; the door points are DOCK's (see layout.doorOf).
// See frontend/public/third-party-notices.txt.

import { NAV_GRID, doorOf, type ZoneId } from './layout';
import { astar, type Point } from './navigation';

export const WALK_SPEED = 120;
export const MIN_WALK_DURATION = 1.5;

export const getZoneDoorPoint = (zone: ZoneId): Point => doorOf(zone);

export function planWalkPath(from: Point, to: Point, fromZone: ZoneId, toZone: ZoneId): Point[] {
  if (fromZone === toZone) return [{ ...from }, { ...to }];
  return [{ ...from }, getZoneDoorPoint(fromZone), getZoneDoorPoint(toZone), { ...to }];
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function pathLength(path: Point[]): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) length += distance(path[index - 1], path[index]);
  return length;
}

export function calculateWalkDuration(path: Point[]): number {
  return Math.max(pathLength(path) / WALK_SPEED, MIN_WALK_DURATION);
}

export function interpolatePathPosition(path: Point[], progress: number): Point {
  if (path.length === 0) return { x: 0, y: 0 };
  if (progress <= 0) return { ...path[0] };
  if (progress >= 1) return { ...path[path.length - 1] };
  const totalLength = pathLength(path);
  if (totalLength === 0) return { ...path[0] };
  const targetDistance = progress * totalLength;
  let accumulated = 0;
  for (let index = 1; index < path.length; index += 1) {
    const segmentLength = distance(path[index - 1], path[index]);
    if (accumulated + segmentLength >= targetDistance) {
      const segmentProgress = segmentLength > 0 ? (targetDistance - accumulated) / segmentLength : 0;
      return {
        x: path[index - 1].x + (path[index].x - path[index - 1].x) * segmentProgress,
        y: path[index - 1].y + (path[index].y - path[index - 1].y) * segmentProgress,
      };
    }
    accumulated += segmentLength;
  }
  return { ...path[path.length - 1] };
}

/** Door waypoints from openclaw-office, each leg refined by Claw3D's A* so desks are walked around. */
export function routeThroughDoors(from: Point, to: Point, fromZone: ZoneId, toZone: ZoneId, grid: Uint8Array = NAV_GRID): Point[] {
  const waypoints = planWalkPath(from, to, fromZone, toZone);
  const route: Point[] = [{ ...waypoints[0] }];
  for (let index = 1; index < waypoints.length; index += 1) {
    const leg = astar(waypoints[index - 1].x, waypoints[index - 1].y, waypoints[index].x, waypoints[index].y, grid);
    if (leg.length) route.push(...leg);
    else route.push({ ...waypoints[index] });
  }
  return route;
}
