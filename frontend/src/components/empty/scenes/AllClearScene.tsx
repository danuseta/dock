import type { CSSProperties } from 'react';

const CONFETTI = [
  { dx: -58, dy: -38, r: '200deg', color: 'fill-status-warn' },
  { dx: 56, dy: -42, r: '-160deg', color: 'fill-status-discord' },
  { dx: -70, dy: 6, r: '120deg', color: 'fill-accent' },
  { dx: 72, dy: 2, r: '-220deg', color: 'fill-status-merged' },
  { dx: -40, dy: 44, r: '260deg', color: 'fill-status-conflict' },
  { dx: 42, dy: 46, r: '-90deg', color: 'fill-status-warn' },
  { dx: -18, dy: -52, r: '180deg', color: 'fill-status-discord' },
  { dx: 22, dy: -54, r: '-140deg', color: 'fill-accent' },
];

export function AllClearScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <circle className="fill-status-merged-bg" cx="110" cy="60" r="30" />
      <circle className="dock-empty-draw stroke-status-merged" strokeWidth="3" pathLength={1} cx="110" cy="60" r="30" transform="rotate(-90 110 60)" />
      <path className="dock-empty-draw dock-empty-draw-late stroke-status-merged" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" pathLength={1} d="M96 61 L106 71 L125 50" />
      {CONFETTI.map((piece) => (
        <rect
          key={`${piece.dx}:${piece.dy}`}
          className={`dock-empty-confetti ${piece.color}`}
          style={{ '--dx': piece.dx, '--dy': piece.dy, '--r': piece.r } as CSSProperties}
          x="108" y="56" width="4" height="7" rx="1"
        />
      ))}
    </svg>
  );
}
