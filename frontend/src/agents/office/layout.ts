import { buildNavGrid, type FurnitureItem, type Point } from './navigation';

// DOCK's own floor plan. One desk for the lead, one for the owner's decision
// gates, and a pod per ticket: the sub-coordinator's desk at the front and six
// member desks behind it. Everyone works seated at a real desk.

export type ZoneId = 'lead' | 'you' | 'corridor' | `pod${number}`;

export interface Zone { x: number; y: number; width: number; height: number }

export const MAX_PODS = 6;
export const MEMBER_DESKS = 6;
export const CORRIDOR_Y = 288;

export const LEAD_ZONE: Zone = { x: 250, y: 60, width: 500, height: 195 };
export const YOU_ZONE: Zone = { x: 1000, y: 60, width: 650, height: 195 };
export const LEAD_SEAT: Point = { x: 500, y: 187 };
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
  return { x: pod.x + 260, y: pod.y + 112 };
}

const memberDesk = (index: number, desk: number): Point => {
  const pod = podZone(index);
  return { x: pod.x + 30 + (desk % 3) * 170, y: pod.y + 165 + Math.floor(desk / 3) * 100 };
};

export function memberSeat(index: number, desk: number): Point {
  const origin = memberDesk(index, desk % MEMBER_DESKS);
  return { x: origin.x + 50, y: origin.y + 77 };
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
    { type: 'chair', x: pod.x + 248, y: pod.y + 100 },
  ];
  for (let desk = 0; desk < MEMBER_DESKS; desk += 1) {
    const origin = memberDesk(index, desk);
    items.push(
      { type: 'desk_cubicle', x: origin.x, y: origin.y },
      { type: 'computer', x: origin.x + 35, y: origin.y + 12 },
      { type: 'chair', x: origin.x + 38, y: origin.y + 65 },
    );
  }
  return items;
}

export const FURNITURE: FurnitureItem[] = [
  { type: 'executive_desk', x: 435, y: 95 }, { type: 'computer', x: 460, y: 110 }, { type: 'computer', x: 515, y: 110 }, { type: 'chair', x: 488, y: 175 },
  { type: 'plant', x: 280, y: 80 }, { type: 'lamp', x: 700, y: 80 }, { type: 'bookshelf', x: 80, y: 70 },
  { type: 'executive_desk', x: 1260, y: 95 }, { type: 'chair', x: 1313, y: 66, r: 2 }, { type: 'plant', x: 1030, y: 80 }, { type: 'couch', x: 1510, y: 80 },
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
