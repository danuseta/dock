export function RobotScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <line className="stroke-muted-foreground" strokeWidth="2" x1="110" y1="20" x2="110" y2="30" />
      <circle className="dock-empty-dot fill-status-warn" style={{ animationDuration: '2s' }} cx="110" cy="17" r="4" />
      <rect className="fill-surface-1 stroke-border" strokeWidth="1.5" x="86" y="30" width="48" height="36" rx="10" />
      <rect className="dock-empty-eye fill-accent" x="98" y="41" width="8" height="11" rx="3" />
      <rect className="dock-empty-eye fill-accent" x="114" y="41" width="8" height="11" rx="3" />
      <rect className="fill-muted-foreground" x="104" y="57" width="12" height="3" rx="1.5" />
      <rect className="fill-surface-2 stroke-border" strokeWidth="1.5" x="92" y="70" width="36" height="32" rx="8" />
      <rect className="fill-surface-2" x="80" y="74" width="10" height="22" rx="5" />
      <rect className="dock-empty-wave fill-surface-2" x="132" y="50" width="10" height="24" rx="5" />
      <line className="stroke-border" strokeWidth="1.5" x1="60" y1="106" x2="160" y2="106" />
    </svg>
  );
}
