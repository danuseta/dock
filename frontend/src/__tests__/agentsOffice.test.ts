import assert from 'node:assert';
import test from 'node:test';
import {
  ACTIVE_GRACE_WINDOW, THINKING_WINDOW_SECS, applyHook, isStale, poseOf, slotFromServer, tickActivity,
  type ActivitySlot,
} from '../agents/office/activity';
import {
  EXIT, FURNITURE, LEAD_SEAT, MAX_PODS, MEMBER_DESKS, NAV_GRID,
  coordinatorSeat, doorOf, memberSeat, podId, podIndexOf, podZone, railIndex, waitingSpot,
} from '../agents/office/layout';
import { calculateWalkDuration, interpolatePathPosition, pathLength, planWalkPath, routeThroughDoors } from '../agents/office/movement';
import { GRID_CELL, GRID_COLS, astar, buildNavGrid, toWorld } from '../agents/office/navigation';
import { formatAge, runStatus, shirtColor, splitTeam, stageName } from '../agents/runs';
import { sampleRuns, sampleTimeline } from '../agents/sampleRuns';

const blocked = (x: number, y: number) => NAV_GRID[Math.floor(y / GRID_CELL) * GRID_COLS + Math.floor(x / GRID_CELL)] === 1;
const reaches = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const path = astar(from.x, from.y, to.x, to.y, NAV_GRID);
  return path.length > 0 && path[path.length - 1].x === to.x && path[path.length - 1].y === to.y;
};

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

test('ledger stages map onto the six-stop rail, and a review names them its own way', () => {
  assert.deepStrictEqual(['gate', 'plan', 'code', 'test', 'verify', 'evidence', 'commit', 'pr', 'done', 'blocked'].map(railIndex), [0, 1, 2, 3, 4, 4, 4, 5, 6, 0]);
  assert.deepStrictEqual(['code', 'verify', 'pr'].map((stage) => stageName(stage, 'build')), ['Code', 'Verify', 'PR']);
  assert.deepStrictEqual(['code', 'verify', 'pr'].map((stage) => stageName(stage, 'review')), ['Review', 'Evidence', 'Verdict']);
});

test('every pod has a reachable desk for its coordinator and each member', () => {
  const seats = new Set<string>();
  for (let pod = 0; pod < MAX_PODS; pod += 1) {
    const zone = podZone(pod);
    const door = doorOf(podId(pod));
    assert.strictEqual(blocked(door.x, door.y), false, `pod ${pod} door is on free floor`);
    const inside = (point: { x: number; y: number }) => point.x > zone.x && point.x < zone.x + zone.width && point.y > zone.y && point.y < zone.y + zone.height;

    const front = coordinatorSeat(pod);
    assert.ok(inside(front) && reaches(door, front), `pod ${pod} coordinator seat`);
    seats.add(`${front.x},${front.y}`);
    for (let desk = 0; desk < MEMBER_DESKS; desk += 1) {
      const seat = memberSeat(pod, desk);
      assert.ok(inside(seat), `pod ${pod} desk ${desk} is inside the pod`);
      assert.strictEqual(blocked(seat.x, seat.y), false, `pod ${pod} desk ${desk} seat is free floor`);
      assert.ok(reaches(front, seat), `pod ${pod} desk ${desk} can be walked to from the front desk`);
      seats.add(`${seat.x},${seat.y}`);
    }
    assert.strictEqual(podIndexOf(podId(pod)), pod);
  }
  assert.strictEqual(seats.size, MAX_PODS * (MEMBER_DESKS + 1), 'no two people share a seat');
  assert.strictEqual(podIndexOf('you'), -1);
});

test('the lead, the owner queue and the exit are all reachable from a pod', () => {
  const from = coordinatorSeat(4);
  for (let index = 0; index < 7; index += 1) {
    const spot = waitingSpot(index, 7);
    assert.strictEqual(blocked(spot.x, spot.y), false, `queue spot ${index}`);
    assert.ok(reaches(from, spot), `queue spot ${index} from a back pod`);
  }
  assert.strictEqual(new Set(Array.from({ length: 7 }, (_, index) => waitingSpot(index, 7).x)).size, 7);
  assert.ok(reaches(from, EXIT));
  assert.ok(reaches(doorOf('lead'), LEAD_SEAT));
});

test('A* walks around furniture and never cuts through a blocked cell', () => {
  const grid = buildNavGrid(FURNITURE);
  const start = coordinatorSeat(0);
  const end = memberSeat(0, 5);
  const path = astar(start.x, start.y, end.x, end.y, grid);
  assert.ok(path.length > 1);
  assert.deepStrictEqual(path[path.length - 1], end);
  for (const point of path.slice(0, -1)) assert.strictEqual(blocked(point.x, point.y), false);

  const walled = new Uint8Array(grid.length).fill(1);
  assert.deepStrictEqual(astar(100, 100, 900, 900, walled), []);
});

test('walks between areas leave by one door and enter by the other', () => {
  const from = coordinatorSeat(3);
  const to = waitingSpot(0, 1);
  assert.deepStrictEqual(planWalkPath(from, to, 'pod3', 'you'), [from, doorOf('pod3'), doorOf('you'), to]);
  assert.deepStrictEqual(planWalkPath(from, to, 'pod3', 'pod3'), [from, to]);

  const route = routeThroughDoors(from, to, 'pod3', 'you');
  assert.deepStrictEqual(route[0], from);
  assert.deepStrictEqual(route[route.length - 1], to);
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

test('a team splits into one sub-coordinator and its members', () => {
  const agent = (id: string, parentId: string | null, name: string) => ({ id, parentId, name, state: 'active', tools: 0 });
  const nested = splitTeam([agent('main', null, 'lead'), agent('c', 'main', 'executor'), agent('m1', 'c', 'executor'), agent('m2', 'c', 'test-runner')]);
  assert.deepStrictEqual([nested.coordinator?.id, nested.members.map((member) => member.id)], ['c', ['m1', 'm2']]);

  const named = splitTeam([agent('c', 'main', 'coord-1406')]);
  assert.deepStrictEqual([named.coordinator?.id, named.members.length], ['c', 0], 'a coordinator that has not spawned anyone yet is known by its name');

  const direct = splitTeam([agent('a', 'main', 'code-reviewer'), agent('b', 'main', 'test-runner')]);
  assert.deepStrictEqual([direct.coordinator, direct.members.length], [null, 2], 'without one, the lead handles the ticket and everyone is a member');
  assert.deepStrictEqual(splitTeam(undefined), { coordinator: null, members: [] });
});

test('the sample run cycles through the stages and ends at a gate', () => {
  const stages = [0, 7, 14, 21, 28].map((second) => sampleRuns(second).find((run) => run.key === 'SAMPLE-2'));
  assert.deepStrictEqual(stages.map((run) => run?.stage), ['code', 'test', 'verify', 'verify', 'verify']);
  assert.deepStrictEqual(stages.map((run) => run?.activity), ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'WAITING']);
  assert.ok(sampleRuns(0).every((run) => run.sample));
  assert.deepStrictEqual(sampleRuns(-1).map((run) => run.stage), sampleRuns(0).map((run) => run.stage), 'a clock that lags the start does not break the script');
});

test('the sample flow puts a coordinator between the lead and its team', () => {
  const coding = sampleTimeline(1);
  const team = splitTeam(coding.agents);
  assert.deepStrictEqual([coding.stageIndex, team.coordinator?.name, team.members.length], [2, 'coord-sample', 4]);
  assert.ok(team.members.every((member) => member.parentId === team.coordinator?.id));
  assert.strictEqual(coding.buckets.length, 48);
  assert.ok(sampleTimeline(6).agents.filter((agent) => agent.state === 'done').length >= 3, 'members finish before the stage ends');

  const gated = sampleTimeline(29);
  assert.deepStrictEqual([gated.stageIndex, gated.agents[0].state], [4, 'waiting']);
  assert.deepStrictEqual(gated.gates.map((gate) => gate.state), ['passed', 'waiting']);
  assert.ok(gated.buckets.some((bucket) => bucket.gate));
  assert.deepStrictEqual(sampleTimeline(-3).stageIndex, sampleTimeline(0).stageIndex);
});
