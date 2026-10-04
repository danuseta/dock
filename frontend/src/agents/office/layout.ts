import { buildNavGrid, type FurnitureItem, type Point } from './navigation';

// DOCK's own floor plan: five stage rooms along one corridor, the owner's desk
// across it, and a door on the right that tickets leave through once the PR is open.

export type ZoneId = 'gate' | 'plan' | 'code' | 'test' | 'verify' | 'you' | 'corridor';
export type StageZone = Exclude<ZoneId, 'you' | 'corridor'>;

export const STAGE_ZONES: StageZone[] = ['gate', 'plan', 'code', 'test', 'verify'];

export const ZONE_META: Record<StageZone, { name: string; color: string }> = {
  gate: { name: 'Gate', color: '#9aa0aa' },
  plan: { name: 'Plan', color: '#8c9bf0' },
  code: { name: 'Code', color: '#e8c56c' },
  test: { name: 'Test', color: '#62cf9f' },
  verify: { name: 'Verify', color: '#5cc0e0' },
};

export const CORRIDOR_Y = 575;
export const CORRIDOR_W = 90;

export interface Zone { x: number; y: number; width: number; height: number }

export const ZONES: Record<Exclude<ZoneId, 'corridor'>, Zone> = {
  gate: { x: 90, y: 110, width: 300, height: 420 },
  plan: { x: 420, y: 110, width: 300, height: 420 },
  code: { x: 750, y: 110, width: 300, height: 420 },
  test: { x: 1080, y: 110, width: 300, height: 420 },
  verify: { x: 1410, y: 110, width: 300, height: 420 },
  you: { x: 560, y: 660, width: 680, height: 360 },
};

export const EXIT: Point = { x: 1755, y: CORRIDOR_Y };

export const SPOTS: Record<StageZone, Point[]> = {
  gate: [{ x: 160, y: 300 }, { x: 260, y: 300 }, { x: 210, y: 400 }],
  plan: [{ x: 480, y: 300 }, { x: 660, y: 300 }, { x: 570, y: 420 }],
  code: [{ x: 820, y: 235 }, { x: 970, y: 235 }, { x: 895, y: 400 }],
  test: [{ x: 1150, y: 320 }, { x: 1290, y: 320 }, { x: 1220, y: 440 }],
  verify: [{ x: 1505, y: 260 }, { x: 1600, y: 330 }, { x: 1500, y: 430 }],
};

export const WAITING_ROW: Point = { x: 900, y: 800 };
export const WAITING_GAP = 90;

export const FURNITURE: FurnitureItem[] = [
  { type: 'bookshelf', x: 110, y: 120 }, { type: 'bookshelf', x: 215, y: 120 }, { type: 'lamp', x: 340, y: 130 }, { type: 'plant', x: 350, y: 480 },
  { type: 'round_table', x: 510, y: 230 }, { type: 'chair', x: 478, y: 318, r: 1 }, { type: 'chair', x: 640, y: 318, r: 3 }, { type: 'plant', x: 440, y: 130 },
  { type: 'desk_cubicle', x: 770, y: 140 }, { type: 'computer', x: 805, y: 152 }, { type: 'chair', x: 808, y: 205 },
  { type: 'desk_cubicle', x: 920, y: 140 }, { type: 'computer', x: 955, y: 152 }, { type: 'chair', x: 958, y: 205 },
  { type: 'cabinet', x: 1110, y: 125 }, { type: 'desk_cubicle', x: 1100, y: 225 }, { type: 'computer', x: 1135, y: 237 }, { type: 'chair', x: 1138, y: 290 },
  { type: 'desk_cubicle', x: 1240, y: 225 }, { type: 'computer', x: 1275, y: 237 }, { type: 'chair', x: 1278, y: 290 },
  { type: 'executive_desk', x: 1440, y: 150 }, { type: 'computer', x: 1465, y: 165 }, { type: 'computer', x: 1520, y: 165 }, { type: 'chair', x: 1493, y: 228 }, { type: 'plant', x: 1670, y: 130 },
  { type: 'executive_desk', x: 835, y: 900 }, { type: 'chair', x: 888, y: 975, r: 2 }, { type: 'plant', x: 590, y: 690 }, { type: 'couch', x: 1100, y: 950 }, { type: 'lamp', x: 1190, y: 690 },
];

export const NAV_GRID = buildNavGrid(FURNITURE);

/**
 * The ledger has more stages than the office has rooms. Evidence, commit and
 * PR are all the owner checking finished work, so they share the Verify room.
 */
export function zoneForStage(stage: string): StageZone | 'corridor' {
  if (stage === 'done') return 'corridor';
  if (stage === 'evidence' || stage === 'commit' || stage === 'pr') return 'verify';
  return (STAGE_ZONES as string[]).includes(stage) ? stage as StageZone : 'gate';
}
