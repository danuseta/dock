import React from 'react';
import { cn } from '../lib/cn';

export const MachineChip: React.FC<{ name: string; online?: boolean; className?: string }> = ({ name, online, className }) => (
  <span className={cn('inline-flex flex-none items-center gap-1 rounded-xs border border-border px-1.5 py-px font-mono text-[0.62rem] font-bold text-secondary-foreground', className)}>
    {online !== undefined && <i className={cn('size-1.5 rounded-full', online ? 'bg-status-merged' : 'bg-muted-foreground')} aria-hidden="true" />}
    {name}
    {online !== undefined && <span className="sr-only"> ({online ? 'online' : 'offline'})</span>}
  </span>
);

