import { buildNavGrid, type FurnitureItem, type Point } from './navigation';

// DOCK's own floor plan. One desk for the lead, one for the owner's decision
// gates, and a pod per ticket: the sub-coordinator's desk at the front and six
// member desks behind it. Everyone works seated at a real desk.

export type ZoneId = 'lead' | 'you' | 'lounge' | 'corridor' | `pod${number}`;

export interface Zone { x: number; y: number; width: number; height: number }

export const MAX_PODS = 6;
export const MEMBER_DESKS = 6;
export const CORRIDOR_Y = 288;

export const LEAD_ZONE: Zone = { x: 60, y: 60, width: 400, height: 195 };
export const LOUNGE_ZONE: Zone = { x: 500, y: 60, width: 460, height: 195 };
export const YOU_ZONE: Zone = { x: 1000, y: 60, width: 650, height: 195 };
export const LEAD_SEAT: Point = { x: 240, y: 151 };

/**
 * The chair model's backrest is on its north side. A chair on the south side of
 * a desk therefore has to be turned half-way round, or its back ends up between
 * the sitter and the desk.
 */
const FACING_DESK = 2;

// The desk models are much smaller than the floor they reserve, so a chair placed at the edge
// of that floor sits a body-length away from the desk. Seats are measured from the model instead:
// tucked under a straight desk, and in the inner corner of an L-shaped one.
const STRAIGHT_SEAT = { x: 50, y: 56 };
const CORNER_SEAT = { x: 40, y: 56 };
const chairAt = (seat: Point, r?: number): FurnitureItem => ({ type: 'chair', x: seat.x - 12, y: seat.y - 12, r });
export const EXIT: Point = { x: 1765, y: CORRIDOR_Y };

const POD_WIDTH = 520;
const POD_HEIGHT = 365;
const POD_COLUMNS = [70, 640, 1210];
const POD_ROWS = [320, 700];

export function podZone(index: number): Zone {
  return { x: POD_COLUMNS[index % 3], y: POD_ROWS[Math.floor(index / 3) % 2], width: POD_WIDTH, height: POD_HEIGHT };
}

export const podId = (index: number): ZoneId => `pod${index}`;
export const podIndexOf = (zone: ZoneId): number => (zone.startsWith('pod') ? Number(zone.slice(3)) : -1);

/** Where the sub-coordinator sits: behind the desk at the front of the pod. */
export function coordinatorSeat(index: number): Point {
  const pod = podZone(index);
  return { x: pod.x + 195 + CORNER_SEAT.x, y: pod.y + 22 + CORNER_SEAT.y };
}

const memberDesk = (index: number, desk: number): Point => {
  const pod = podZone(index);
  return { x: pod.x + 30 + (desk % 3) * 170, y: pod.y + 165 + Math.floor(desk / 3) * 100 };
};

export function memberSeat(index: number, desk: number): Point {
  const origin = memberDesk(index, desk % MEMBER_DESKS);
  return { x: origin.x + STRAIGHT_SEAT.x, y: origin.y + STRAIGHT_SEAT.y };
}

/** Tickets nobody is working on right now stand here instead of holding a pod. */
export const LOUNGE_SPOTS = 12;
export function loungeSpot(index: number): Point {
  const slot = index % LOUNGE_SPOTS;
  return { x: LOUNGE_ZONE.x + 55 + (slot % 6) * 70, y: LOUNGE_ZONE.y + 105 + Math.floor(slot / 6) * 62 };
}

/** Tickets waiting on the owner queue up in front of the owner's desk. */
export function waitingSpot(index: number, count: number): Point {
  const perRow = 7;
  const row = Math.floor(index / perRow);
  const inRow = Math.min(perRow, count - row * perRow);
  return { x: 1325 + ((index % perRow) - (inRow - 1) / 2) * 78, y: 226 - row * 30 };
}

/** A waypoint on the corridor side of each area; walks between areas pass through two of them. */
export function doorOf(zone: ZoneId): Point {
  if (zone === 'corridor') return { ...EXIT };
  if (zone === 'lead') return { x: LEAD_ZONE.x + LEAD_ZONE.width / 2, y: CORRIDOR_Y };
  if (zone === 'you') return { x: YOU_ZONE.x + YOU_ZONE.width / 2, y: CORRIDOR_Y };
  if (zone === 'lounge') return { x: LOUNGE_ZONE.x + LOUNGE_ZONE.width / 2, y: CORRIDOR_Y };
  const index = podIndexOf(zone);
  const pod = podZone(index);
  // The front desk sits in the middle of the pod's top edge, so the way in is beside it.
  return index < 3 ? { x: pod.x + 110, y: CORRIDOR_Y } : { x: pod.x + 110, y: pod.y - 8 };
}

function podFurniture(index: number): FurnitureItem[] {
  const pod = podZone(index);
  const items: FurnitureItem[] = [
    { type: 'executive_desk', x: pod.x + 195, y: pod.y + 22 },
    { type: 'computer', x: pod.x + 220, y: pod.y + 37 },
    { type: 'computer', x: pod.x + 275, y: pod.y + 37 },
    chairAt(coordinatorSeat(index), FACING_DESK),
  ];
  for (let desk = 0; desk < MEMBER_DESKS; desk += 1) {
    const origin = memberDesk(index, desk);
    items.push(
      { type: 'desk_cubicle', x: origin.x, y: origin.y },
      { type: 'computer', x: origin.x + 35, y: origin.y + 12 },
      chairAt(memberSeat(index, desk), FACING_DESK),
    );
  }
  return items;
}

export const FURNITURE: FurnitureItem[] = [
  { type: 'executive_desk', x: 200, y: 95 }, { type: 'computer', x: 225, y: 110 }, { type: 'computer', x: 280, y: 110 }, chairAt(LEAD_SEAT, FACING_DESK),
  { type: 'plant', x: 85, y: 80 }, { type: 'lamp', x: 420, y: 80 },
  { type: 'couch', x: 540, y: 78 }, { type: 'couch', x: 700, y: 78 }, { type: 'plant', x: 900, y: 80 },
  // The owner sits on the far side of the desk, facing the queue.
  { type: 'executive_desk', x: 1260, y: 95, r: 2 }, chairAt({ x: 1350, y: 104 }), { type: 'plant', x: 1030, y: 80 }, { type: 'bookshelf', x: 1540, y: 66 },
  ...Array.from({ length: MAX_PODS }, (_, index) => podFurniture(index)).flat(),
];

export const NAV_GRID = buildNavGrid(FURNITURE);

/** Build runs and reviews move through the same six stops but call them differently. */
export const RAIL_STAGES = ['gate', 'plan', 'code', 'test', 'verify', 'pr'] as const;

export function railIndex(stage: string): number {
  if (stage === 'done') return RAIL_STAGES.length;
  if (stage === 'evidence' || stage === 'commit') return 4;
  const index = (RAIL_STAGES as readonly string[]).indexOf(stage);
  return index === -1 ? 0 : index;
}
