import assert from 'node:assert';
import test from 'node:test';
import {
  ACTIVE_GRACE_WINDOW, THINKING_WINDOW_SECS, applyHook, isStale, poseOf, slotFromServer, tickActivity,
  type ActivitySlot,
} from '../agents/office/activity';
import { FURNITURE, NAV_GRID, SPOTS, STAGE_ZONES, WAITING_ROW, zoneForStage } from '../agents/office/layout';
import { calculateWalkDuration, getZoneDoorPoint, interpolatePathPosition, pathLength, planWalkPath, routeThroughDoors } from '../agents/office/movement';
import { GRID_CELL, GRID_COLS, astar, buildNavGrid, toWorld } from '../agents/office/navigation';
import { formatAge, runStatus, shirtColor } from '../agents/runs';
import { sampleRuns } from '../agents/sampleRuns';

const blocked = (x: number, y: number) => NAV_GRID[Math.floor(y / GRID_CELL) * GRID_COLS + Math.floor(x / GRID_CELL)] === 1;

test('status rules: grace window, thinking window and staleness', () => {
  const slot: ActivitySlot = { state: 'IDLE', detail: null, lastEventAt: 0, endedAt: null };

  applyHook(slot, 'PreToolUse', 100, 'Edit');
  assert.deepStrictEqual([slot.state, slot.detail, poseOf(slot, 100)], ['ACTIVE', 'Edit', 'SeatedTyping']);

  applyHook(slot, 'PostToolUse', 101);
  tickActivity(slot, 101 + ACTIVE_GRACE_WINDOW - 0.1);
  assert.strictEqual(slot.state, 'ACTIVE', 'still typing inside the grace window');
  tickActivity(slot, 101 + ACTIVE_GRACE_WINDOW);
  assert.strictEqual(slot.state, 'IDLE');

  assert.strictEqual(poseOf(slot, 101 + THINKING_WINDOW_SECS - 1), 'SeatedThinking');
  assert.strictEqual(poseOf(slot, 101 + THINKING_WINDOW_SECS), 'Asleep');

  applyHook(slot, 'PermissionRequest', 200);
  assert.deepStrictEqual([slot.state, slot.detail, poseOf(slot, 9999)], ['WAITING', 'permission', 'SeatedWaiting']);
  assert.strictEqual(isStale(slot, 200 + 3599), false);
  assert.strictEqual(isStale(slot, 200 + 3601), true);
});

test('server ages become local timestamps without trusting either clock', () => {
  const slot = slotFromServer({ activity: 'ACTIVE', activityDetail: 'Bash', idleSeconds: 12, endedSeconds: 1 }, 1000);
  assert.deepStrictEqual(slot, { state: 'ACTIVE', detail: 'Bash', lastEventAt: 988, endedAt: 999 });
  assert.strictEqual(slotFromServer({ activity: 'UNKNOWN', idleSeconds: 0 }, 5).state, 'IDLE');
});

test('ledger stages map onto the five rooms', () => {
  assert.deepStrictEqual(['gate', 'plan', 'code', 'test', 'verify'].map(zoneForStage), STAGE_ZONES);
  assert.deepStrictEqual(['evidence', 'commit', 'pr'].map(zoneForStage), ['verify', 'verify', 'verify']);
  assert.strictEqual(zoneForStage('done'), 'corridor');
  assert.strictEqual(zoneForStage('blocked'), 'gate');
});

test('every door is on walkable floor and every seat can be reached from it', () => {
  for (const zone of STAGE_ZONES) {
    const door = getZoneDoorPoint(zone);
    assert.strictEqual(blocked(door.x, door.y), false, `${zone} door`);
    // Seats at a table sit inside its padding; A* steps to the nearest free cell and finishes on the seat.
    for (const spot of SPOTS[zone]) {
      const path = astar(door.x, door.y, spot.x, spot.y, NAV_GRID);
      assert.deepStrictEqual(path[path.length - 1], spot, `${zone} seat ${spot.x},${spot.y}`);
    }
  }
  for (const offset of [-225, -135, -45, 45, 135, 225]) {
    assert.strictEqual(blocked(WAITING_ROW.x + offset, WAITING_ROW.y), false, `waiting spot ${offset}`);
  }
});

test('A* walks around furniture and never cuts through a blocked cell', () => {
  const grid = buildNavGrid(FURNITURE);
  const path = astar(820, 235, 970, 235, grid);
  assert.ok(path.length > 1);
  assert.deepStrictEqual(path[path.length - 1], { x: 970, y: 235 });
  for (const point of path) assert.strictEqual(blocked(point.x, point.y), false);

  const walled = new Uint8Array(grid.length).fill(1);
  assert.deepStrictEqual(astar(100, 100, 900, 900, walled), []);
});

test('walks between rooms leave by one door and enter by the other', () => {
  const from = SPOTS.code[0];
  const to = SPOTS.verify[0];
  assert.deepStrictEqual(planWalkPath(from, to, 'code', 'verify'), [from, getZoneDoorPoint('code'), getZoneDoorPoint('verify'), to]);
  assert.deepStrictEqual(planWalkPath(from, to, 'code', 'code'), [from, to]);

  const route = routeThroughDoors(from, { ...WAITING_ROW }, 'code', 'you');
  assert.deepStrictEqual(route[0], from);
  assert.deepStrictEqual(route[route.length - 1], WAITING_ROW);
  for (const point of route.slice(1, -1)) assert.strictEqual(blocked(point.x, point.y), false);

  const straight = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }];
  assert.strictEqual(pathLength(straight), 240);
  assert.strictEqual(calculateWalkDuration(straight), 2);
  assert.strictEqual(calculateWalkDuration([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 1.5);
  assert.deepStrictEqual(interpolatePathPosition(straight, 0.75), { x: 120, y: 60 });
  assert.deepStrictEqual(interpolatePathPosition(straight, 2), { x: 120, y: 120 });
});

test('the floor plan is centred on the world origin', () => {
  assert.deepStrictEqual(toWorld(900, 550), [0, 0, 0]);
});

test('a run is summarised by its worst news first', () => {
  const run = { stage: 'code', waiting: null, acFailed: 0, stalled: false, activity: 'ACTIVE', idleSeconds: 1, endedSeconds: null };
  assert.strictEqual(runStatus(run, 1000), 'working');
  assert.strictEqual(runStatus({ ...run, activity: 'IDLE', idleSeconds: 5 }, 1000), 'thinking');
  assert.strictEqual(runStatus({ ...run, activity: 'IDLE', idleSeconds: 60 }, 1000), 'asleep');
  assert.strictEqual(runStatus({ ...run, stalled: true }, 1000), 'stalled');
  assert.strictEqual(runStatus({ ...run, stalled: true, acFailed: 1 }, 1000), 'failed');
  assert.strictEqual(runStatus({ ...run, acFailed: 1, waiting: 'Approve the plan' }, 1000), 'waiting');
  assert.strictEqual(runStatus({ ...run, stage: 'done', waiting: 'x' }, 1000), 'done');

  assert.deepStrictEqual([5, 89, 90, 5400, 172800].map(formatAge), ['5 s', '89 s', '2 min', '2 h', '2 d']);
  assert.strictEqual(shirtColor('QRD-1387'), shirtColor('QRD-1387'));
});

test('the sample run cycles through the stages and ends at a gate', () => {
  const stages = [0, 7, 14, 21, 28].map((second) => sampleRuns(second).find((run) => run.key === 'SAMPLE-2'));
  assert.deepStrictEqual(stages.map((run) => run?.stage), ['code', 'test', 'verify', 'verify', 'verify']);
  assert.deepStrictEqual(stages.map((run) => run?.activity), ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'WAITING']);
  assert.ok(sampleRuns(0).every((run) => run.sample));
  assert.deepStrictEqual(sampleRuns(-1).map((run) => run.stage), sampleRuns(0).map((run) => run.stage), 'a clock that lags the start does not break the script');
});
