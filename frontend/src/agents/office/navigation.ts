// Ported from Claw3D (MIT, (c) 2026 Luke The Dev): core/constants.ts,
// core/geometry.ts and core/navigation.ts. buildNavGrid and astar keep the
// original algorithm (binary heap, 8 directions, no corner cutting); the canvas
// size and the furniture types in use are DOCK's. See frontend/public/third-party-notices.txt.

export const CANVAS_W = 1800;
export const CANVAS_H = 1100;
export const SCALE = 0.018;
export const AGENT_SCALE = 1.75;
export const WALK_ANIM_SPEED = 0.15;
export const GRID_CELL = 25;
export const GRID_COLS = Math.ceil(CANVAS_W / GRID_CELL);
export const GRID_ROWS = Math.ceil(CANVAS_H / GRID_CELL);

export type FurnitureType =
  | 'desk_cubicle' | 'executive_desk' | 'chair' | 'round_table' | 'couch'
  | 'bookshelf' | 'plant' | 'cabinet' | 'computer' | 'lamp';

export interface FurnitureItem { type: FurnitureType; x: number; y: number; r?: number }
export interface Point { x: number; y: number }

export const toWorld = (cx: number, cy: number): [number, number, number] => [
  cx * SCALE - CANVAS_W * SCALE * 0.5,
  0,
  cy * SCALE - CANVAS_H * SCALE * 0.5,
];

export const FURNITURE_GLB: Record<FurnitureType, string> = {
  desk_cubicle: 'desk.glb',
  executive_desk: 'deskCorner.glb',
  chair: 'chairDesk.glb',
  round_table: 'tableRound.glb',
  couch: 'loungeSofa.glb',
  bookshelf: 'bookcaseClosed.glb',
  plant: 'pottedPlant.glb',
  cabinet: 'kitchenCabinet.glb',
  computer: 'computerScreen.glb',
  lamp: 'lampRoundFloor.glb',
};

export const FURNITURE_SCALE: Record<FurnitureType, [number, number, number]> = {
  desk_cubicle: [1.5, 1.5, 1.5],
  executive_desk: [1.8, 1.8, 1.8],
  chair: [1.2, 1.2, 1.2],
  round_table: [3.2, 3.2, 3.2],
  couch: [1.8, 1.8, 1.8],
  bookshelf: [1.5, 2, 1.5],
  plant: [1.2, 1.8, 1.2],
  cabinet: [2.6, 1.2, 1],
  computer: [1.1, 1.1, 1.1],
  lamp: [1.2, 1.2, 1.2],
};

export const FURNITURE_Y_OFFSET: Partial<Record<FurnitureType, number>> = { computer: 0.61 };

export const ITEM_FOOTPRINT: Record<FurnitureType, [number, number]> = {
  desk_cubicle: [100, 55],
  chair: [24, 24],
  round_table: [120, 120],
  executive_desk: [130, 65],
  couch: [100, 40],
  bookshelf: [80, 120],
  plant: [24, 24],
  cabinet: [200, 40],
  computer: [30, 20],
  lamp: [30, 30],
};

const BLOCKS_NAV = new Set<FurnitureType>(['desk_cubicle', 'round_table', 'executive_desk', 'couch', 'bookshelf', 'cabinet']);

export function buildNavGrid(furniture: FurnitureItem[]): Uint8Array {
  const grid = new Uint8Array(GRID_COLS * GRID_ROWS);
  const defaultPad = GRID_CELL * 0.6;
  for (const item of furniture) {
    if (!BLOCKS_NAV.has(item.type)) continue;
    const itemPad = item.type === 'desk_cubicle' ? 0 : defaultPad;
    const [width, height] = ITEM_FOOTPRINT[item.type];
    const c1 = Math.max(0, Math.floor((item.x - itemPad) / GRID_CELL));
    const c2 = Math.min(GRID_COLS - 1, Math.floor((item.x + width + itemPad) / GRID_CELL));
    const r1 = Math.max(0, Math.floor((item.y - itemPad) / GRID_CELL));
    const r2 = Math.min(GRID_ROWS - 1, Math.floor((item.y + height + itemPad) / GRID_CELL));
    for (let row = r1; row <= r2; row += 1) {
      for (let column = c1; column <= c2; column += 1) grid[row * GRID_COLS + column] = 1;
    }
  }
  for (let column = 0; column < GRID_COLS; column += 1) {
    grid[column] = 1;
    grid[(GRID_ROWS - 1) * GRID_COLS + column] = 1;
  }
  for (let row = 0; row < GRID_ROWS; row += 1) {
    grid[row * GRID_COLS] = 1;
    grid[row * GRID_COLS + GRID_COLS - 1] = 1;
  }
  return grid;
}

type OpenEntry = [index: number, priority: number];

const DIRECTIONS: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

export function astar(sx: number, sy: number, ex: number, ey: number, grid: Uint8Array): Point[] {
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  const toCell = (x: number, y: number) => ({
    c: clamp(Math.floor(x / GRID_CELL), 0, GRID_COLS - 1),
    r: clamp(Math.floor(y / GRID_CELL), 0, GRID_ROWS - 1),
  });
  const cellCx = (column: number) => column * GRID_CELL + GRID_CELL / 2;
  const cellCy = (row: number) => row * GRID_CELL + GRID_CELL / 2;
  const findFree = (column: number, row: number) => {
    if (!grid[row * GRID_COLS + column]) return { c: column, r: row };
    for (let distance = 1; distance < 10; distance += 1) {
      for (let rowOffset = -distance; rowOffset <= distance; rowOffset += 1) {
        for (let columnOffset = -distance; columnOffset <= distance; columnOffset += 1) {
          if (Math.abs(rowOffset) !== distance && Math.abs(columnOffset) !== distance) continue;
          const nextRow = row + rowOffset;
          const nextColumn = column + columnOffset;
          if (nextRow < 0 || nextRow >= GRID_ROWS || nextColumn < 0 || nextColumn >= GRID_COLS) continue;
          if (!grid[nextRow * GRID_COLS + nextColumn]) return { c: nextColumn, r: nextRow };
        }
      }
    }
    return null;
  };

  const startCell = toCell(sx, sy);
  const endCell = toCell(ex, ey);
  const startFree = findFree(startCell.c, startCell.r);
  const endFree = findFree(endCell.c, endCell.r);
  if (!startFree || !endFree) return [];
  const sc = startFree.c;
  const sr = startFree.r;
  const ec = endFree.c;
  const er = endFree.r;
  if (sc === ec && sr === er) return [{ x: ex, y: ey }];

  const nodeCount = GRID_COLS * GRID_ROWS;
  const gCost = new Float32Array(nodeCount).fill(Infinity);
  const parent = new Int32Array(nodeCount).fill(-1);
  const visited = new Uint8Array(nodeCount);
  const startIndex = sr * GRID_COLS + sc;
  const endIndex = er * GRID_COLS + ec;
  gCost[startIndex] = 0;

  const open: OpenEntry[] = [];
  const pushOpen = (entry: OpenEntry) => {
    open.push(entry);
    let index = open.length - 1;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (open[parentIndex][1] <= entry[1]) break;
      open[index] = open[parentIndex];
      index = parentIndex;
    }
    open[index] = entry;
  };
  const popOpen = (): OpenEntry | null => {
    if (open.length === 0) return null;
    const first = open[0];
    const last = open.pop();
    if (!last || open.length === 0) return first;
    let index = 0;
    for (;;) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      if (leftIndex >= open.length) break;
      let smallestIndex = leftIndex;
      if (rightIndex < open.length && open[rightIndex][1] < open[leftIndex][1]) smallestIndex = rightIndex;
      if (open[smallestIndex][1] >= last[1]) break;
      open[index] = open[smallestIndex];
      index = smallestIndex;
    }
    open[index] = last;
    return first;
  };

  pushOpen([startIndex, Math.hypot(ec - sc, er - sr)]);
  while (open.length) {
    const next = popOpen();
    if (!next) break;
    const current = next[0];
    if (visited[current]) continue;
    visited[current] = 1;
    if (current === endIndex) {
      const path: Point[] = [];
      let node = current;
      while (node !== startIndex) {
        path.push({ x: cellCx(node % GRID_COLS), y: cellCy(Math.floor(node / GRID_COLS)) });
        node = parent[node];
      }
      path.reverse();
      if (path.length) path[path.length - 1] = { x: ex, y: ey };
      else path.push({ x: ex, y: ey });
      return path;
    }
    const currentColumn = current % GRID_COLS;
    const currentRow = Math.floor(current / GRID_COLS);
    for (const [columnOffset, rowOffset, cost] of DIRECTIONS) {
      const nextColumn = currentColumn + columnOffset;
      const nextRow = currentRow + rowOffset;
      if (nextColumn < 0 || nextColumn >= GRID_COLS || nextRow < 0 || nextRow >= GRID_ROWS) continue;
      const nextIndex = nextRow * GRID_COLS + nextColumn;
      if (visited[nextIndex] || grid[nextIndex]) continue;
      if (columnOffset !== 0 && rowOffset !== 0) {
        const orthogonalA = (currentRow + rowOffset) * GRID_COLS + currentColumn;
        const orthogonalB = currentRow * GRID_COLS + (currentColumn + columnOffset);
        if (grid[orthogonalA] || grid[orthogonalB]) continue;
      }
      const nextCost = gCost[current] + cost;
      if (nextCost < gCost[nextIndex]) {
        gCost[nextIndex] = nextCost;
        parent[nextIndex] = current;
        pushOpen([nextIndex, nextCost + Math.hypot(ec - nextColumn, er - nextRow)]);
      }
    }
  }
  return [];
}
