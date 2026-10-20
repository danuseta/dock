const ROWS = [
  { y: 16, width: 130, delay: '0s' },
  { y: 42, width: 156, delay: '.35s' },
  { y: 68, width: 104, delay: '.7s' },
  { y: 94, width: 140, delay: '1.05s' },
];

export function SkeletonScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      {ROWS.map((row) => (
        <g key={row.y}>
          <circle className="fill-surface-2" cx="26" cy={row.y + 4} r="8" />
          <rect className="dock-empty-row fill-surface-2" style={{ animationDelay: row.delay }} x="42" y={row.y} width={row.width} height="8" rx="4" />
        </g>
      ))}
    </svg>
  );
}
