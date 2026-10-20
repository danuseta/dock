const UNITS = [20, 50, 80];

export function RackScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <rect className="fill-surface-0 stroke-border" strokeWidth="1.5" x="70" y="12" width="80" height="96" rx="6" />
      {UNITS.map((y, index) => (
        <g key={y}>
          <rect className="fill-surface-1 stroke-border" strokeWidth="1.5" x="78" y={y} width="64" height="24" rx="3" />
          <rect className="fill-surface-2" x="84" y={y + 10} width="28" height="4" rx="2" />
          <circle className="dock-empty-led fill-status-merged" style={{ animationDelay: `${index * 0.5}s` }} cx="124" cy={y + 12} r="2.6" />
          <circle className="dock-empty-led fill-status-warn" style={{ animationDelay: `${index * 0.5 + 0.8}s` }} cx="133" cy={y + 12} r="2.6" />
        </g>
      ))}
    </svg>
  );
}
