import { Box, ChevronRight } from 'lucide-react';
import type { DockerRuntime } from '../lib/dockerRuntime';
import { dockerStatusTone } from '../lib/dockerRuntime';
import { Button, Card } from './ui';
import { cn } from '../lib/cn';

interface DockerRuntimeCardProps {
  runtime?: DockerRuntime;
  onNavigate: (path: string) => void;
  compact?: boolean;
}

export const DockerRuntimeCard = ({ runtime, onNavigate, compact = false }: DockerRuntimeCardProps) => (
  <Card className="overflow-hidden p-0">
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex items-center gap-2.5"><Box className="size-4 text-accent" aria-hidden="true" /><h2 className="text-balance font-display text-sm font-bold">Docker services</h2></div>
      <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs" onClick={() => onNavigate('/docker')}>View all <ChevronRight size={14} aria-hidden="true" /></Button>
    </header>
    {!runtime?.available ? (
      <div className="px-4 py-5 text-pretty text-sm text-muted-foreground">Docker runtime is unavailable.</div>
    ) : (
      <>
        <div className="grid grid-cols-3 border-b border-border bg-surface-1 [&>div]:border-r [&>div]:border-border [&>div:last-child]:border-r-0">
          {[['Total', runtime.total], ['Running', runtime.running], ['Stopped', runtime.stopped]].map(([label, value]) => <div className="px-3 py-2.5" key={label}><strong className="block font-mono text-base tabular-nums">{value}</strong><span className="text-[0.65rem] text-muted-foreground">{label}</span></div>)}
        </div>
        {runtime.containers.slice(0, compact ? 3 : 4).map((container) => (
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0" key={container.id}>
            <span className={cn('size-2 shrink-0 rounded-full', dockerStatusTone(container.state))} aria-hidden="true" />
            <span className="min-w-0 flex-1"><strong className="block truncate text-xs">{container.name}</strong><small className="block truncate font-mono text-[0.63rem] text-muted-foreground">{container.image}</small></span>
            <span className="font-mono text-[0.65rem] text-muted-foreground tabular-nums">{container.uptime}</span>
          </div>
        ))}
        {runtime.containers.length === 0 && <div className="px-4 py-5 text-sm text-muted-foreground">No containers found.</div>}
      </>
    )}
  </Card>
);
