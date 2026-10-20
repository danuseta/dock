import { useId } from 'react';

const FRAMES = [8, 48, 88, 128, 168, 208, 248, 288];

export function FilmScene(): JSX.Element {
  const clip = `dock-empty-film-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <defs><clipPath id={clip}><rect x="20" y="28" width="180" height="64" rx="6" /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        <g className="dock-empty-film">
          <rect className="fill-surface-2" x="0" y="28" width="320" height="64" />
          <line className="stroke-muted-foreground" opacity=".5" strokeWidth="3" strokeDasharray="4 6" x1="0" y1="34" x2="320" y2="34" />
          <line className="stroke-muted-foreground" opacity=".5" strokeWidth="3" strokeDasharray="4 6" x1="0" y1="86" x2="320" y2="86" />
          {FRAMES.map((x) => <rect key={x} className="fill-surface-1" x={x} y="42" width="32" height="36" rx="3" />)}
        </g>
      </g>
      <rect className="stroke-border" strokeWidth="1.5" x="20" y="28" width="180" height="64" rx="6" />
      <circle className="fill-surface-0 stroke-border-glow" strokeWidth="1.5" cx="110" cy="60" r="15" />
      <path className="fill-accent" d="M106 53 L118 60 L106 67 Z" />
    </svg>
  );
}
