import { useId } from 'react';

const CHARS = [38, 47, 56, 65, 74, 92, 101, 110, 119, 128];

export function TerminalScene(): JSX.Element {
  const clip = `dock-empty-terminal-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <defs><clipPath id={clip}><rect x="12" y="38" width="196" height="70" /></clipPath></defs>
      <rect className="fill-surface-1 stroke-border" strokeWidth="1.5" x="10" y="10" width="200" height="100" rx="10" />
      <circle className="fill-surface-2" cx="26" cy="24" r="3.5" />
      <circle className="fill-surface-2" cx="37" cy="24" r="3.5" />
      <circle className="fill-surface-2" cx="48" cy="24" r="3.5" />
      <line className="stroke-border" strokeWidth="1.5" x1="10" y1="36" x2="210" y2="36" />
      <text className="fill-accent font-mono text-[14px] font-semibold" x="22" y="63">&gt;</text>
      <g clipPath={`url(#${clip})`}>
        <g className="dock-empty-typed">
          {CHARS.map((x) => <rect key={x} className="fill-muted-foreground" x={x} y="53" width="6" height="10" rx="1.5" />)}
        </g>
        <g className="dock-empty-type">
          <rect className="dock-empty-blink fill-accent" x="38" y="51" width="2.5" height="14" />
          <rect className="fill-surface-1" x="41" y="49" width="110" height="18" />
        </g>
      </g>
      <rect className="fill-surface-2" x="22" y="80" width="120" height="5" rx="2.5" />
      <rect className="fill-surface-2" x="22" y="91" width="76" height="5" rx="2.5" />
    </svg>
  );
}
