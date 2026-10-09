import { Card } from '../components/ui';
import { PALETTE, trendPath, trendX, trendY, type TrendGeometry } from './format';
import type { SprintTrend } from './types';

const GEOMETRY: TrendGeometry = { width: 720, height: 260, left: 44, right: 20, top: 16, bottom: 36 };
const GRID = [0, 25, 50, 75, 100];

export const TrendSection = ({ trend }: { trend: SprintTrend | null }) => {
  const series = trend?.series ?? [];
  const labels = trend?.labels ?? [];
  const colorOf = (index: number, color: string | null) => color || PALETTE[index % PALETTE.length];

  return (
    <section className="mb-6">
      <h2 className="font-display text-xl font-bold">Velocity trend</h2>
      <p className="mt-1 mb-3 max-w-[980px] text-pretty text-sm text-muted-foreground">
        Dev velocity across the stored sprints. Developers with no load in the two most recent sprints are left out, and a line that ends mid-chart means no load after it. This chart does not change with the sprint selector.
      </p>
      <Card className="p-4">
        {series.length === 0 ? <p className="text-sm text-muted-foreground">No sprint history yet. Run the backfill to fill it.</p> : (
          <>
            {labels.length < 2 && <p className="mb-3 text-sm text-muted-foreground">Only one sprint is stored, so each line is a single point.</p>}
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {series.map((line, index) => (
                <span key={line.dev} className="inline-flex items-center gap-1.5">
                  <i className="inline-block size-2.5 rounded-xs" style={{ background: colorOf(index, line.color) }} />{line.dev}
                </span>
              ))}
            </div>
            <svg viewBox={`0 0 ${GEOMETRY.width} ${GEOMETRY.height}`} className="h-auto w-full" role="img" aria-label="Line chart of dev velocity across sprints">
              {GRID.map((value) => (
                <g key={value}>
                  <line x1={GEOMETRY.left} x2={GEOMETRY.width - GEOMETRY.right} y1={trendY(value, GEOMETRY)} y2={trendY(value, GEOMETRY)} className="stroke-border" strokeWidth={1} />
                  <text x={GEOMETRY.left - 8} y={trendY(value, GEOMETRY) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{value}%</text>
                </g>
              ))}
              {labels.map((label, index) => (
                <text key={label} x={trendX(index, labels.length, GEOMETRY)} y={GEOMETRY.height - 12} textAnchor="middle" className="fill-muted-foreground text-[11px]">{label}</text>
              ))}
              {series.map((line, index) => (
                <g key={line.dev} stroke={colorOf(index, line.color)} fill={colorOf(index, line.color)}>
                  <path d={trendPath(line.data, GEOMETRY)} fill="none" strokeWidth={2} />
                  {line.data.map((value, point) => value === null ? null : (
                    <circle key={labels[point]} cx={trendX(point, labels.length, GEOMETRY)} cy={trendY(value, GEOMETRY)} r={4} stroke="none">
                      <title>{`${line.dev} · ${labels[point]} · ${value}%`}</title>
                    </circle>
                  ))}
                </g>
              ))}
            </svg>
          </>
        )}
      </Card>
    </section>
  );
};
