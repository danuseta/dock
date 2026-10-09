import { Card } from '../components/ui';
import { cn } from '../lib/cn';
import { fmt, pct } from './format';
import type { SprintResult } from './types';

export const OverviewSection = ({ result }: { result: SprintResult }) => {
  const { overview } = result;
  const targetPerDev = overview.developers ? overview.targetSP / overview.developers : 0;
  const metrics = [
    { label: 'Developers', value: String(overview.developers), sup: 'active in sprint' },
    { label: 'Total SP', value: fmt(overview.totalSP), sup: 'alloc + carry + bug' },
    { label: 'Allocated', value: fmt(overview.allocated), sup: `target ${overview.developers} × ${fmt(targetPerDev)} = ${fmt(overview.targetSP)}` },
    { label: 'Carryover', value: fmt(overview.carryover), sup: `${overview.totalSP ? pct(overview.carryover / overview.totalSP) : '0%'} of load` },
    { label: 'Bug SP', value: fmt(overview.bugSP), sup: overview.bugSP > overview.bugMargin ? 'over margin' : 'within margin' },
    { label: 'Done', value: fmt(overview.doneSP), sup: `${overview.totalSP ? pct(overview.doneSP / overview.totalSP) : '0%'} of total` },
  ];
  const segments = [
    { label: 'In Dev', value: overview.pipeline.inDev, tone: 'bg-status-draft', note: 'Todo / In Progress / PR Review' },
    { label: 'UATM', value: overview.pipeline.uatMerged, tone: 'bg-status-warn', note: 'UAT Merged' },
    { label: 'UATC+RFP', value: overview.pipeline.uatCheckRfp, tone: 'bg-status-discord', note: 'UAT Check + Ready for Production' },
    { label: 'UATB', value: overview.pipeline.uatBug, tone: 'bg-status-conflict', note: 'UAT Bug' },
    { label: 'Done', value: overview.pipeline.done, tone: 'bg-status-merged', note: 'Done' },
  ];

  return (
    <section className="mb-6">
      <h2 className="font-display text-xl font-bold">Sprint overview (team)</h2>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">Capacity and pipeline distribution at the cutoff.</p>
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-4">
            <div className="text-xs text-muted-foreground">{metric.label}</div>
            <strong className="font-display text-3xl tabular-nums">{metric.value}</strong>
            <div className="text-xs text-muted-foreground">{metric.sup}</div>
          </Card>
        ))}
      </div>
      <div className="flex h-9 w-full overflow-hidden rounded-sm border border-border" role="img" aria-label="Pipeline distribution by story points">
        {segments.filter((segment) => segment.value > 0).map((segment) => (
          <div
            key={segment.label}
            className={cn('flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap px-1 text-xs font-semibold text-black', segment.tone)}
            style={{ flex: segment.value }}
          >
            {segment.label} {fmt(segment.value)}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-1.5">
            <i className={cn('inline-block size-2.5 rounded-xs', segment.tone)} />{segment.note}
          </span>
        ))}
      </div>
    </section>
  );
};
