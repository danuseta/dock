import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 w-full rounded-sm border border-border bg-surface-0 px-4 font-body text-sm text-foreground',
      'placeholder:text-muted-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
      'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-status-conflict aria-invalid:ring-status-conflict/30',
      '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
      className,
    )}
    {...props}
  />
));

Input.displayName = 'Input';
