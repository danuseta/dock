import React from 'react';
import { Hammer, SearchCheck, StickyNote } from 'lucide-react';
import { cn } from '../lib/cn';
import { kindLabel } from './runs';

export const KindBadge: React.FC<{ kind?: string | null; icon?: boolean; className?: string }> = ({ kind, icon = true, className }) => {
  const Icon = kind === 'review' ? SearchCheck : kind === 'card' ? StickyNote : Hammer;
  return (
    <span className={cn('inline-flex flex-none items-center gap-1 rounded-xs border border-border px-1.5 py-px font-mono text-[0.62rem] font-bold text-secondary-foreground', className)}>
      {icon && <Icon size={10} aria-hidden="true" />}
      {kindLabel(kind)}
    </span>
  );
};
