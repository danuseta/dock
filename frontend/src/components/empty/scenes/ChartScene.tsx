const BARS = [
  { x: 44, y: 70, delay: '0s' },
  { x: 72, y: 52, delay: '.15s' },
  { x: 100, y: 60, delay: '.3s' },
  { x: 128, y: 38, delay: '.45s' },
];

export function ChartScene(): JSX.Element {
  return (
    <svg viewBox="0 0 220 120" className="size-full" fill="none">
      <line className="stroke-border" strokeWidth="1.5" strokeDasharray="3 5" x1="30" y1="40" x2="190" y2="40" />
      <line className="stroke-border" strokeWidth="1.5" strokeDasharray="3 5" x1="30" y1="70" x2="190" y2="70" />
      {BARS.map((bar) => (
        <rect key={bar.x} className="dock-empty-bar fill-muted-foreground" opacity=".55" style={{ animationDelay: bar.delay }} x={bar.x} y={bar.y} width="18" height={100 - bar.y} rx="3" />
      ))}
      <rect className="dock-empty-bar fill-accent" style={{ animationDelay: '.6s' }} x="156" y="46" width="18" height="54" rx="3" />
      <line className="stroke-border-glow" strokeWidth="1.5" x1="30" y1="100" x2="190" y2="100" />
    </svg>
  );
}
