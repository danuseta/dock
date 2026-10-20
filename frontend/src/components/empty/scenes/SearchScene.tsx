export function SearchScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <rect className="fill-surface-2" opacity=".6" x="30" y="24" width="160" height="7" rx="3.5" />
      <rect className="fill-surface-2" opacity=".6" x="30" y="44" width="130" height="7" rx="3.5" />
      <rect className="fill-surface-2" opacity=".6" x="30" y="64" width="150" height="7" rx="3.5" />
      <rect className="fill-surface-2" opacity=".6" x="30" y="84" width="110" height="7" rx="3.5" />
      <g className="dock-empty-sweep">
        <circle className="fill-accent-dim stroke-accent" strokeWidth="3" cx="110" cy="56" r="20" />
        <line className="stroke-accent" strokeWidth="5" strokeLinecap="round" x1="124" y1="70" x2="140" y2="86" />
      </g>
    </svg>
  );
}
