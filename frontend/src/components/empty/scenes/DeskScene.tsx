export function DeskScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <line className="stroke-border" strokeWidth="1.5" x1="20" y1="104" x2="200" y2="104" />
      <rect className="fill-surface-1 stroke-border" strokeWidth="1.5" x="85" y="34" width="50" height="32" rx="3" />
      <rect className="dock-empty-screen fill-accent" x="89" y="38" width="42" height="24" rx="2" />
      <rect className="dock-empty-blink fill-accent" x="93" y="44" width="8" height="3" rx="1" />
      <rect className="fill-surface-2" x="107" y="66" width="6" height="5" />
      <rect className="fill-surface-2" x="48" y="71" width="124" height="6" rx="2" />
      <rect className="fill-surface-2" x="56" y="77" width="4" height="27" />
      <rect className="fill-surface-2" x="160" y="77" width="4" height="27" />
      <rect className="fill-surface-1 stroke-border" strokeWidth="1.5" x="178" y="58" width="20" height="26" rx="4" />
      <rect className="fill-surface-2" x="174" y="82" width="28" height="5" rx="2" />
      <line className="stroke-border" strokeWidth="1.5" x1="188" y1="87" x2="188" y2="104" />
      <circle className="dock-empty-dot fill-muted-foreground" cx="104" cy="22" r="2.5" />
      <circle className="dock-empty-dot fill-muted-foreground" style={{ animationDelay: '.2s' }} cx="110" cy="22" r="2.5" />
      <circle className="dock-empty-dot fill-muted-foreground" style={{ animationDelay: '.4s' }} cx="116" cy="22" r="2.5" />
    </svg>
  );
}
