import { useEffect, useRef, useState } from 'react';
import { Card } from '../components/ui';
import { EmptyState } from '../components/EmptyState';
import { ChartScene } from '../components/empty/scenes/ChartScene';
import { PALETTE, nearestIndex, trendPath, trendX, trendY, type TrendGeometry } from './format';
import type { SprintTrend } from './types';

const HEIGHT = 300;
const GRID = [0, 20, 40, 60, 80, 100];

export const TrendSection = ({ trend }: { trend: SprintTrend | null }) => {
  const series = trend?.series ?? [];
  const labels = trend?.labels ?? [];
  const hasData = series.length > 0;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasData]);

  const geometry: TrendGeometry = { width, height: HEIGHT, left: 44, right: 28, top: 12, bottom: 30 };
  const colorOf = (index: number, color: string | null) => color || PALETTE[index % PALETTE.length];
  const labelStep = Math.ceil(labels.length / Math.max(1, Math.floor((width - 60) / 56)));
  const hoverX = hover === null ? 0 : trendX(hover, labels.length, geometry);
  const tooltipOnLeft = hoverX > width / 2;

  return (
    <section className="mb-6">
      <h2 className="font-display text-xl font-bold">Velocity trend</h2>
      <p className="mt-1 mb-3 max-w-[980px] text-pretty text-sm text-muted-foreground">
        Dev velocity across the stored sprints. Developers with no load in the two most recent sprints are left out, and a line that ends mid-chart means no load after it. This chart does not change with the sprint selector.
      </p>
      <Card className="p-4">
        {!hasData ? <EmptyState size="panel" scene={<ChartScene />} description="No sprint history yet. Load the last sprints to fill it." /> : (
          <>
            {labels.length < 2 && <p className="mb-3 text-sm text-muted-foreground">Only one sprint is stored, so each line is a single point.</p>}
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {series.map((line, index) => (
                <span key={line.dev} className="inline-flex items-center gap-1.5">
                  <i className="inline-block size-2.5 rounded-xs" style={{ background: colorOf(index, line.color) }} />{line.dev}
                </span>
              ))}
            </div>
            <div ref={wrap} className="relative" style={{ height: HEIGHT }}>
              <svg
                width={width}
                height={HEIGHT}
                role="img"
                aria-label="Line chart of dev velocity across sprints"
                onMouseMove={(event) => setHover(nearestIndex(event.clientX - event.currentTarget.getBoundingClientRect().left, labels.length, geometry))}
                onMouseLeave={() => setHover(null)}
              >
                {GRID.map((value) => (
                  <g key={value}>
                    <line x1={geometry.left} x2={width - geometry.right} y1={trendY(value, geometry)} y2={trendY(value, geometry)} className="stroke-border" strokeWidth={1} />
                    <text x={geometry.left - 8} y={trendY(value, geometry) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{value}%</text>
                  </g>
                ))}
                {labels.map((label, index) => index % labelStep === 0 && (
                  <text key={label} x={trendX(index, labels.length, geometry)} y={HEIGHT - 10} textAnchor="middle" className="fill-muted-foreground text-[11px]">{label}</text>
                ))}
                {hover !== null && <line x1={hoverX} x2={hoverX} y1={geometry.top} y2={HEIGHT - geometry.bottom} className="stroke-border-accent" strokeWidth={1} />}
                {series.map((line, index) => (
                  <g key={line.dev} stroke={colorOf(index, line.color)} fill={colorOf(index, line.color)}>
                    <path d={trendPath(line.data, geometry)} fill="none" strokeWidth={2} />
                    {line.data.map((value, point) => value === null ? null : (
                      <circle key={labels[point]} cx={trendX(point, labels.length, geometry)} cy={trendY(value, geometry)} r={point === hover ? 5 : 3} stroke="none" />
                    ))}
                  </g>
                ))}
              </svg>
              {hover !== null && (
                <div
                  className="pointer-events-none absolute top-2 z-10 min-w-[140px] rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs shadow-card"
                  style={tooltipOnLeft ? { right: width - hoverX + 12 } : { left: hoverX + 12 }}
                  role="status"
                >
                  <div className="mb-1 font-display font-semibold">{labels[hover]}</div>
                  {series.map((line, index) => (
                    <div key={line.dev} className="flex items-center justify-between gap-4 tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        <i className="inline-block size-2 rounded-xs" style={{ background: colorOf(index, line.color) }} />{line.dev}
                      </span>
                      <span>{line.data[hover] === null ? '—' : `${Math.round((line.data[hover] as number) * 10) / 10}%`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </section>
  );
};
