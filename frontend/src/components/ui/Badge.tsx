import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'danger' | 'draft';

const variants: Record<BadgeVariant, string> = {
  neutral: 'border-border bg-surface-2 text-secondary-foreground',
  accent: 'border-accent/30 bg-accent-dim text-accent',
  success: 'border-status-merged/30 bg-status-merged-bg text-status-merged',
  danger: 'border-status-conflict/30 bg-status-conflict-bg text-status-conflict',
  draft: 'border-status-draft/30 bg-status-draft-bg text-status-draft',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge = ({ className, variant = 'neutral', ...props }: BadgeProps) => (
  <span
    className={cn('inline-flex items-center rounded-pill border px-2 py-0.5 font-mono text-xs font-semibold', variants[variant], className)}
    {...props}
  />
);
