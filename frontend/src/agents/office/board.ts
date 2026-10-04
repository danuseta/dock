// Ported from hermes-virtual-office (MIT, (c) 2026 Hermes Virtual Office
// Contributors): src/lib/office/board.ts. HTML cards ride on a wall mesh through
// a CSS2DObject and are resized each frame to the board's projected size. The
// columns are DOCK's ticket stages. See frontend/public/third-party-notices.txt.

import type { Mesh } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export interface BoardTask {
  id: string;
  column: number;
  title: string;
  status: 'running' | 'review' | 'blocked';
}

export interface BoardCards {
  render(tasks: BoardTask[]): void;
  setBoardSize(widthPx: number, heightPx: number): void;
  dispose(): void;
}

export function buildBoardCards(boardMesh: Mesh, columnNames: string[], onClick: (id: string) => void): BoardCards {
  const root = document.createElement('div');
  root.className = 'dock-board-cards';
  const object = new CSS2DObject(root);
  object.position.set(0, 0, 0.09);
  boardMesh.add(object);

  const grid = document.createElement('div');
  grid.className = 'dock-board-cols';
  root.appendChild(grid);
  const headRow = document.createElement('div');
  headRow.className = 'dock-board-colheads';
  grid.appendChild(headRow);
  const bodyRow = document.createElement('div');
  bodyRow.className = 'dock-board-cols-row';
  grid.appendChild(bodyRow);

  const columns: HTMLDivElement[] = [];
  for (const name of columnNames) {
    const head = document.createElement('div');
    head.className = 'dock-board-col';
    head.textContent = name;
    headRow.appendChild(head);

    const column = document.createElement('div');
    column.className = 'dock-board-cards-col';
    column.addEventListener('wheel', (event) => {
      event.preventDefault();
      column.scrollTop += event.deltaY;
    });
    bodyRow.appendChild(column);
    columns.push(column);
  }

  let lastSignature = '';
  const render = (tasks: BoardTask[]) => {
    const signature = tasks.map((task) => `${task.id}:${task.column}:${task.status}:${task.title}`).sort().join('|');
    if (signature === lastSignature) return;
    lastSignature = signature;
    const scrolled = columns.map((column) => column.scrollTop);
    for (const column of columns) column.textContent = '';
    const perColumn: BoardTask[][] = columnNames.map(() => []);
    for (const task of tasks) perColumn[Math.min(columnNames.length - 1, Math.max(0, task.column))].push(task);
    perColumn.forEach((list, index) => {
      const column = columns[index];
      for (const task of list) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'dock-board-card';
        card.dataset.status = task.status;
        card.textContent = task.title;
        card.title = `Open ${task.id}`;
        card.addEventListener('click', (event) => {
          event.stopPropagation();
          onClick(task.id);
        });
        column.appendChild(card);
      }
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'dock-board-empty';
        empty.textContent = '—';
        column.appendChild(empty);
      }
      column.scrollTop = scrolled[index] ?? 0;
    });
  };

  const setBoardSize = (widthPx: number, heightPx: number) => {
    const width = Math.max(180, Math.min(900, widthPx * 0.9));
    const height = Math.max(40, Math.min(420, heightPx * 0.66));
    grid.style.width = `${width}px`;
    for (const column of columns) column.style.maxHeight = `${height}px`;
  };

  return {
    render,
    setBoardSize,
    dispose: () => {
      boardMesh.remove(object);
      root.remove();
    },
  };
}
