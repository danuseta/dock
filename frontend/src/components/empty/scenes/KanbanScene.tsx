export function KanbanScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <rect className="fill-surface-0 stroke-border" strokeWidth="1.5" x="24" y="12" width="52" height="98" rx="6" />
      <rect className="fill-surface-0 stroke-border" strokeWidth="1.5" x="84" y="12" width="52" height="98" rx="6" />
      <rect className="fill-surface-0 stroke-border" strokeWidth="1.5" x="144" y="12" width="52" height="98" rx="6" />
      <rect className="fill-surface-2" x="30" y="20" width="40" height="16" rx="3" />
      <rect className="fill-surface-2" x="30" y="40" width="40" height="12" rx="3" />
      <rect className="fill-status-merged-bg stroke-status-merged" strokeWidth="1.2" x="150" y="20" width="40" height="20" rx="3" />
      <path className="stroke-status-merged" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M163 30 L167 34 L176 25" />
      <g className="dock-empty-drop">
        <rect className="fill-accent-dim stroke-accent" strokeWidth="1.2" x="90" y="20" width="40" height="22" rx="3" />
        <rect className="fill-accent" x="95" y="26" width="22" height="3" rx="1.5" />
        <rect className="fill-accent" opacity=".6" x="95" y="33" width="14" height="3" rx="1.5" />
      </g>
    </svg>
  );
}
