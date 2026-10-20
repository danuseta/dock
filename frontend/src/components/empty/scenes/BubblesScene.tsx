export function BubblesScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <g className="dock-empty-bubble">
        <rect className="fill-surface-2" x="20" y="12" width="110" height="28" rx="12" />
        <rect className="fill-muted-foreground" opacity=".7" x="32" y="21" width="70" height="4" rx="2" />
        <rect className="fill-muted-foreground" opacity=".5" x="32" y="29" width="44" height="4" rx="2" />
      </g>
      <g className="dock-empty-bubble" style={{ animationDelay: '.7s' }}>
        <rect className="fill-accent-dim stroke-accent/40" x="90" y="46" width="110" height="28" rx="12" />
        <rect className="fill-accent" opacity=".75" x="102" y="55" width="76" height="4" rx="2" />
        <rect className="fill-accent" opacity=".5" x="102" y="63" width="50" height="4" rx="2" />
      </g>
      <g className="dock-empty-bubble" style={{ animationDelay: '1.4s' }}>
        <rect className="fill-surface-2" x="20" y="80" width="90" height="28" rx="12" />
        <rect className="fill-muted-foreground" opacity=".7" x="32" y="89" width="56" height="4" rx="2" />
        <rect className="fill-muted-foreground" opacity=".5" x="32" y="97" width="30" height="4" rx="2" />
      </g>
    </svg>
  );
}
