import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps {
  scene: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  size?: 'page' | 'panel';
  className?: string;
}

export function EmptyState({ scene, title, description, action, size = 'page', className }: EmptyStateProps): JSX.Element {
  const page = size === 'page';
  return (
    <div role="status" className={cn('flex flex-col items-center text-center', page ? 'px-4 py-10' : 'px-3 py-6', className)}>
      <div className={cn('dock-empty-scene', page ? 'mb-4 h-[120px] w-[220px]' : 'mb-3 h-[88px] w-[160px]')} aria-hidden="true">{scene}</div>
      {title && (page
        ? <h2 className="mb-1 text-balance font-display text-lg font-bold">{title}</h2>
        : <p className="mb-1 text-balance font-display text-sm font-bold">{title}</p>)}
      {description && <div className={cn('max-w-[420px] text-pretty text-muted-foreground', page ? 'text-sm' : 'text-xs')}>{description}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
