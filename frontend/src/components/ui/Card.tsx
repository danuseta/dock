import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(({ className, interactive = false, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'relative overflow-hidden rounded-md border border-border bg-surface-1 p-6 shadow-card',
      interactive && 'transition-colors duration-150 ease-out hover:border-border-glow',
      className,
    )}
    {...props}
  />
));

Card.displayName = 'Card';
