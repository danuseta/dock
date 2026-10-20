export function CalendarScene(): JSX.Element {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const month = today.toLocaleString('en', { month: 'short' }).toUpperCase();
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <rect className="fill-surface-1 stroke-border" strokeWidth="1.5" x="70" y="22" width="80" height="84" rx="8" />
      <rect className="fill-accent-dim" x="71" y="23" width="78" height="21" rx="7" />
      <text className="fill-accent font-mono text-[9px] font-bold tracking-[1px]" x="110" y="37" textAnchor="middle">{month}</text>
      <rect className="fill-surface-2" x="88" y="15" width="5" height="13" rx="2.5" />
      <rect className="fill-surface-2" x="127" y="15" width="5" height="13" rx="2.5" />
      <text className="fill-muted-foreground font-display text-[30px] font-bold" x="110" y="88" textAnchor="middle">{tomorrow.getDate()}</text>
      <g className="dock-empty-flip">
        <rect className="fill-surface-1" x="72" y="45" width="76" height="59" rx="4" />
        <text className="fill-foreground font-display text-[30px] font-bold" x="110" y="88" textAnchor="middle">{today.getDate()}</text>
      </g>
    </svg>
  );
}
