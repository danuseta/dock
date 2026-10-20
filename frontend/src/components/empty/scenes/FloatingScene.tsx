export function FloatingScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <ellipse className="dock-empty-shadow fill-surface-2" cx="110" cy="106" rx="34" ry="4" />
      <g className="dock-empty-float">
        <rect className="fill-surface-2 stroke-border-glow" strokeWidth="1.5" x="60" y="22" width="100" height="58" rx="16" />
        <path className="fill-surface-2" d="M78 78 L72 94 L94 80 Z" />
        <circle className="dock-empty-dot fill-muted-foreground" cx="92" cy="51" r="5" />
        <circle className="dock-empty-dot fill-muted-foreground" style={{ animationDelay: '.2s' }} cx="110" cy="51" r="5" />
        <circle className="dock-empty-dot fill-muted-foreground" style={{ animationDelay: '.4s' }} cx="128" cy="51" r="5" />
      </g>
    </svg>
  );
}
