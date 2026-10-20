import assert from 'node:assert';
import test from 'node:test';
import {
  ACTIVE_GRACE_WINDOW, THINKING_WINDOW_SECS, applyHook, isStale, poseOf, slotFromServer, tickActivity,
  type ActivitySlot,
} from '../agents/office/activity';
import {
  EXIT, FURNITURE, LEAD_SEAT, LOUNGE_GROUP_SPOTS, LOUNGE_SPOTS, LOUNGE_ZONE, MAX_PODS, MEMBER_DESKS, NAV_GRID, QUEUE_PER_ROW, YOU_ZONE,
  coordinatorSeat, doorOf, isSofaSeat, loungeLabelSpot, loungeSpot, memberSeat, podId, podIndexOf, podZone, railIndex, waitingSpot,
} from '../agents/office/layout';
import { calculateWalkDuration, interpolatePathPosition, pathLength, planWalkPath, routeThroughDoors } from '../agents/office/movement';
import { GRID_CELL, GRID_COLS, astar, buildNavGrid, toWorld } from '../agents/office/navigation';
import { completeRun, formatAge, hasTrouble, isArchived, moveConfirmation, moveTargets, offerOf, pageOf, runStatus, shirtColor, sortRuns, splitTeam, stageName, statusLabel, type AgentRun, type RunSortColumn } from '../agents/runs';
import { sampleRuns, sampleTimeline } from '../agents/sampleRuns';
import { machineOf, machinePlace } from '../chat/messages';

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
  const queue = Array.from({ length: 10 }, (_, index) => waitingSpot(index, 10));
  queue.forEach((spot, index) => {
    assert.strictEqual(blocked(spot.x, spot.y), false, `queue spot ${index}`);
    assert.ok(reaches(from, spot), `queue spot ${index} from a back pod`);
    assert.ok(spot.x > YOU_ZONE.x && spot.x < YOU_ZONE.x + YOU_ZONE.width, `queue spot ${index} stays at the owner's desk`);
  });
  for (let index = 1; index < QUEUE_PER_ROW; index += 1) {
    assert.ok(queue[index].x - queue[index - 1].x >= 120, 'neighbours in the queue leave room for a ticket tag each');
  }
  assert.ok(queue[QUEUE_PER_ROW].y - queue[0].y >= 40, 'the second row stands clear of the first row\'s tags');
  assert.ok(reaches(from, EXIT));
  const parked = new Set<string>();
  for (const group of ['review', 'idle'] as const) {
    for (let index = 0; index < LOUNGE_GROUP_SPOTS; index += 1) {
      const spot = loungeSpot(index, group);
      // A sofa seat is on the sofa itself, so it is reached from the floor just in front of it.
      const approach = isSofaSeat(index) ? { x: spot.x, y: spot.y + 50 } : spot;
      assert.strictEqual(blocked(spot.x, spot.y), isSofaSeat(index), `${group} lounge spot ${index} is ${isSofaSeat(index) ? 'on a sofa' : 'free floor'}`);
      assert.strictEqual(blocked(approach.x, approach.y), false, `${group} lounge spot ${index} can be walked up to`);
      assert.ok(reaches(from, approach), `${group} lounge spot ${index} from a back pod`);
      assert.ok(spot.x > LOUNGE_ZONE.x && spot.x < LOUNGE_ZONE.x + LOUNGE_ZONE.width && spot.y > LOUNGE_ZONE.y && spot.y < LOUNGE_ZONE.y + LOUNGE_ZONE.height, `${group} lounge spot ${index} stays in the lounge`);
      parked.add(`${spot.x},${spot.y}`);
    }
  }
  assert.strictEqual(parked.size, LOUNGE_SPOTS, 'tickets that are not being worked on do not stand on each other, in either group');
  const middle = LOUNGE_ZONE.x + LOUNGE_ZONE.width / 2;
  for (let index = 0; index < LOUNGE_GROUP_SPOTS; index += 1) {
    assert.ok(loungeSpot(index, 'review').x < middle && loungeSpot(index, 'idle').x > middle, 'each group keeps to its own half of the lounge');
  }
  for (const group of ['review', 'idle'] as const) {
    const spots = Array.from({ length: LOUNGE_GROUP_SPOTS }, (_, index) => loungeSpot(index, group));
    spots.forEach((a, i) => spots.slice(i + 1).forEach((b) => {
      assert.ok(Math.abs(a.x - b.x) >= 45 || Math.abs(a.y - b.y) >= 40, `${group} lounge spots leave room for a compact tag each`);
    }));
  }
  assert.ok(loungeSpot(0, 'idle').x - loungeSpot(2, 'review').x >= 75, 'the two groups do not crowd each other');
  const [reviewLabel, idleLabel] = [loungeLabelSpot('review'), loungeLabelSpot('idle')];
  assert.ok(idleLabel.x - reviewLabel.x >= 200, 'the two floor labels are far enough apart not to overlap');
  assert.ok(reviewLabel.y > loungeSpot(LOUNGE_GROUP_SPOTS - 1, 'review').y, 'labels sit below the last row of tickets');
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
  assert.deepStrictEqual([gated.stageIndex, gated.agents[0].state], [3, 'waiting']);
  assert.deepStrictEqual(gated.gates.map((gate) => gate.state), ['passed', 'waiting']);
  assert.ok(gated.buckets.some((bucket) => bucket.gate));
  assert.deepStrictEqual(sampleTimeline(-3).stageIndex, sampleTimeline(0).stageIndex);
});

test('every chair is tucked at its desk and turned to face it', () => {
  const chairs = FURNITURE.filter((item) => item.type === 'chair');
  const desks = FURNITURE.filter((item) => item.type === 'desk_cubicle' || item.type === 'executive_desk');
  assert.strictEqual(chairs.length, 2 + MAX_PODS * (MEMBER_DESKS + 1));
  for (const chair of chairs) {
    const centre = { x: chair.x + 12, y: chair.y + 12 };
    const desk = desks.find((item) => {
      const [width, depth] = item.type === 'desk_cubicle' ? [100, 55] : [130, 65];
      return centre.x > item.x - 10 && centre.x < item.x + width + 10 && centre.y > item.y - 10 && centre.y < item.y + depth + 10;
    });
    assert.ok(desk, `chair at ${chair.x},${chair.y} sits at a desk, not out on the floor`);
    const deskCentreY = desk.y + (desk.type === 'desk_cubicle' ? 27.5 : 32.5);
    // The chair model's backrest is on its north side at r = 0, so a chair south of its desk is turned round.
    assert.strictEqual(chair.r ?? 0, centre.y > deskCentreY ? 2 : 0, `chair at ${chair.x},${chair.y} has its back to the room, not to the desk`);
  }
});

test('the table sorts by any column, archives finished tickets and pages the rest', () => {
  const run = (key: string, stage: string, idleSeconds: number, waiting = '', acPassed = 0): AgentRun => ({
    ...sampleRuns(0)[0], key, stage, idleSeconds, waiting, acPassed, acTotal: 4, acFailed: 0,
  });
  const runs = [run('QRD-1376', 'code', 30), run('QRD-99', 'pr', 5, 'Approve?', 4), run('QRD-1260', 'done', 900, '', 4), run('QRD-1381', 'gate', 60, '', 2)];
  const status = () => 'working' as const;
  const keys = (column: RunSortColumn, descending = false) => sortRuns(runs, { column, descending }, status).map((item) => item.key);
  assert.deepStrictEqual(keys('ticket'), ['QRD-99', 'QRD-1260', 'QRD-1376', 'QRD-1381'], 'ticket numbers sort as numbers');
  assert.deepStrictEqual(keys('activity'), ['QRD-99', 'QRD-1376', 'QRD-1381', 'QRD-1260'], 'most recent first');
  assert.deepStrictEqual(keys('activity', true)[0], 'QRD-1260');
  assert.deepStrictEqual(keys('stage'), ['QRD-1381', 'QRD-1376', 'QRD-99', 'QRD-1260']);
  assert.strictEqual(keys('waiting')[0], 'QRD-99', 'tickets waiting on the owner come first');
  assert.strictEqual(keys('ac', true)[0], 'QRD-99');
  assert.strictEqual(runs.length, 4, 'sorting does not reorder the list it was given');
  assert.deepStrictEqual(runs.filter(isArchived).map((item) => item.key), ['QRD-1260']);

  const many = Array.from({ length: 23 }, (_, index) => index);
  assert.deepStrictEqual(pageOf(many, 1, 10), { items: many.slice(0, 10), page: 1, pages: 3, from: 1, to: 10 });
  assert.deepStrictEqual(pageOf(many, 3, 10), { items: [20, 21, 22], page: 3, pages: 3, from: 21, to: 23 });
  assert.strictEqual(pageOf(many, 9, 10).page, 3, 'a page past the end falls back to the last one');
  assert.deepStrictEqual(pageOf([], 1, 10), { items: [], page: 1, pages: 1, from: 0, to: 0 });
});

test('a run with an open pull request is in review, not idle, and sorts after working', () => {
  const run = { stage: 'pr', waiting: null, acFailed: 0, stalled: false, activity: 'IDLE', idleSeconds: 60, endedSeconds: null, review: 'open' as const };
  assert.strictEqual(runStatus(run, 1000), 'review');
  assert.strictEqual(runStatus({ ...run, review: 'merged' }, 1000), 'review');
  assert.strictEqual(statusLabel('review', 'open'), 'In review');
  assert.strictEqual(statusLabel('review', 'merged'), 'Merged');
  assert.strictEqual(runStatus({ ...run, review: null }, 1000), 'asleep');
  assert.strictEqual(runStatus({ ...run, activity: 'ACTIVE', idleSeconds: 1 }, 1000), 'working', 'an agent that is typing is still working');
  assert.strictEqual(runStatus({ ...run, acFailed: 1 }, 1000), 'failed');
  assert.strictEqual(runStatus({ ...run, stage: 'done' }, 1000), 'done');

  const runs = ['QRD-1', 'QRD-2', 'QRD-3', 'QRD-4'].map((key) => ({ ...sampleRuns(0)[0], key }));
  const statuses = { 'QRD-1': 'asleep', 'QRD-2': 'review', 'QRD-3': 'working', 'QRD-4': 'thinking' } as const;
  const order = sortRuns(runs, { column: 'status', descending: false }, (item) => statuses[item.key as keyof typeof statuses]).map((item) => item.key);
  assert.deepStrictEqual(order, ['QRD-3', 'QRD-2', 'QRD-4', 'QRD-1']);
});

test('a merged run is archived, an open or closed pull request is not', () => {
  const run = { stage: 'pr', waiting: null, acFailed: 0, stalled: false, activity: 'IDLE', idleSeconds: 60, endedSeconds: null };
  assert.strictEqual(isArchived({ stage: 'pr', finished: true }), true, 'every pull request merged');
  assert.strictEqual(isArchived({ stage: 'done' }), true);
  assert.strictEqual(isArchived({ stage: 'pr', finished: false }), false, 'in review stays on the working list');
  assert.strictEqual(isArchived({ stage: 'pr' }), false);

  assert.strictEqual(runStatus({ ...run, review: 'merged' as const, activity: 'ACTIVE', waiting: 'Approve?' }, 1000), 'review', 'a merged run reads Merged whatever its last event was');
  assert.strictEqual(statusLabel(runStatus({ ...run, review: 'merged' as const }, 1000), 'merged'), 'Merged');
  assert.strictEqual(statusLabel(runStatus({ ...run, review: 'open' as const }, 1000), 'open'), 'In review');
  assert.strictEqual(statusLabel(runStatus({ ...run, stage: 'done', review: null }, 1000), null), 'Done');
  assert.strictEqual(runStatus({ ...run, review: null }, 1000), 'asleep', 'no pull request: still asleep');
});

test('requested changes and a red CI read as trouble, ahead of Stalled, and count in the metric', () => {
  const run = { stage: 'pr', waiting: null, acFailed: 0, stalled: false, activity: 'IDLE', idleSeconds: 60, endedSeconds: null, review: 'open' as const };
  assert.strictEqual(runStatus({ ...run, reviewSignal: 'changes_requested' }, 1000), 'changes_requested');
  assert.strictEqual(runStatus({ ...run, reviewSignal: 'checks_failing' }, 1000), 'checks_failing');
  for (const reviewSignal of ['checks_pending', 'approved', null] as const) assert.strictEqual(runStatus({ ...run, reviewSignal }, 1000), 'review', String(reviewSignal));
  assert.strictEqual(runStatus({ ...run, reviewSignal: 'changes_requested', activity: 'ACTIVE', idleSeconds: 1 }, 1000), 'working', 'an agent fixing it is still working');
  assert.strictEqual(runStatus({ ...run, reviewSignal: 'changes_requested', acFailed: 1 }, 1000), 'failed');
  assert.strictEqual(runStatus({ ...run, reviewSignal: 'changes_requested', review: 'merged' }, 1000), 'review', 'a merged run is finished');
  assert.strictEqual(statusLabel('changes_requested'), 'Changes requested');
  assert.strictEqual(statusLabel('checks_failing'), 'CI failing');

  const trouble = (extra: object) => hasTrouble({ acFailed: 0, stalled: false, review: 'open', reviewSignal: null, ...extra });
  assert.deepStrictEqual(
    [trouble({ reviewSignal: 'changes_requested' }), trouble({ reviewSignal: 'checks_failing' }), trouble({ reviewSignal: 'checks_pending' }), trouble({ reviewSignal: 'approved' }), trouble({}), trouble({ acFailed: 1 }), trouble({ stalled: true }), trouble({ stalled: true, review: null })],
    [true, true, false, false, false, true, false, true],
  );

  const runs = ['QRD-1', 'QRD-2', 'QRD-3', 'QRD-4', 'QRD-5'].map((key) => ({ ...sampleRuns(0)[0], key }));
  const statuses = { 'QRD-1': 'stalled', 'QRD-2': 'checks_failing', 'QRD-3': 'failed', 'QRD-4': 'changes_requested', 'QRD-5': 'working' } as const;
  const order = sortRuns(runs, { column: 'status', descending: false }, (item) => statuses[item.key as keyof typeof statuses]).map((item) => item.key);
  assert.deepStrictEqual(order, ['QRD-3', 'QRD-4', 'QRD-2', 'QRD-1', 'QRD-5'], 'right after failed, before stalled');
});

test('a ticket shows the machine that owns it; a run without a machine belongs to the laptop', () => {
  const run = { ...sampleRuns(0)[0], key: 'ZED-101' };
  assert.strictEqual(machineOf(run), 'laptop');
  assert.strictEqual(machineOf({ ...run, machine: 'workspace' }), 'workspace');
  assert.strictEqual(machineOf({ ...run, machine: null }), 'laptop');
  assert.deepStrictEqual([machinePlace('laptop'), machinePlace('workspace')], ['your laptop', 'workspace']);
  const runs = [{ ...run, machine: 'workspace' }, { ...run, key: 'ZED-102' }];
  assert.deepStrictEqual(sortRuns(runs, { column: 'ticket', descending: false }, () => 'working').map((item) => [item.key, machineOf(item)]), [['ZED-101', 'workspace'], ['ZED-102', 'laptop']], 'the machine travels with the run through sorting');
});

test('an offered ticket shows the target machine and the time; a run without an offer shows none', () => {
  const run = { ...sampleRuns(0)[0], key: 'ZED-101' };
  assert.strictEqual(offerOf(run), null);
  assert.strictEqual(offerOf({ ...run, handoverTo: null, handoverAt: null }), null);
  assert.strictEqual(offerOf({ ...run, handoverAt: '2026-10-11T09:30:00.000Z' }), null, 'a time without a target is no offer');
  const offer = offerOf({ ...run, handoverTo: 'workspace', handoverAt: '2026-10-11T09:30:00.000Z' });
  assert.strictEqual(offer?.to, 'workspace');
  assert.match(offer?.label || '', /^Offered to workspace · .*\d{2}:\d{2}$/);
  assert.strictEqual(offerOf({ ...run, handoverTo: 'workspace' })?.label, 'Offered to workspace');
  assert.strictEqual(offerOf({ ...run, handoverTo: 'workspace', handoverAt: 'not a time' })?.label, 'Offered to workspace');
});

test('a ticket can move to every machine but its own, and nowhere with one machine', () => {
  const machines = [{ name: 'laptop', online: true }, { name: 'workspace', online: false }];
  assert.deepStrictEqual(moveTargets(machines, 'laptop'), [{ name: 'workspace', online: false }]);
  assert.deepStrictEqual(moveTargets(machines, 'workspace'), [{ name: 'laptop', online: true }]);
  assert.deepStrictEqual(moveTargets([{ name: 'laptop', online: true }], 'laptop'), []);
  assert.deepStrictEqual(moveTargets(undefined, 'laptop'), []);
});

test('the move confirmation names both machines and warns when the target is offline', () => {
  const online = moveConfirmation('ZED-101', 'laptop', 'workspace', true);
  assert.match(online, /Move ZED-101 from laptop to workspace\?/);
  assert.match(online, /chat sessions of laptop do not move/);
  assert.match(online, /Work still running on laptop is not stopped, and its updates will be ignored\./);
  assert.doesNotMatch(online, /offline/);
  const offline = moveConfirmation('ZED-101', 'laptop', 'workspace', false);
  assert.match(offline, /workspace is offline, so nothing will pick ZED-101 up until it starts\.$/);
});

test('a run cached by the Home query completes to lists the Agents page can read', () => {
  const homeRun = { key: 'ZED-101', title: 'Home shaped', stage: 'code', waiting: null, acPassed: 1, acFailed: 0, acTotal: 3, activity: 'ACTIVE', idleSeconds: 4, endedSeconds: null, stalled: false, finished: false };
  const run = completeRun(homeRun as unknown as Parameters<typeof completeRun>[0]);
  assert.deepStrictEqual([run.ac, run.pullRequests, run.decisions, run.assumptions, run.failures, run.members], [[], [], [], [], [], []]);
  assert.doesNotThrow(() => run.ac.length);
  assert.strictEqual(completeRun({ ...homeRun, ac: null } as unknown as Parameters<typeof completeRun>[0]).ac.length, 0);
  const full = { ...sampleRuns(0)[0] };
  assert.strictEqual(completeRun(full).ac, full.ac, 'a list the server sent is kept');
});
