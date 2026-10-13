import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'icon';

const variants: Record<ButtonVariant, string> = {
  default: 'border-border bg-surface-2 text-foreground hover:border-border-glow hover:bg-surface-hover',
  primary: 'border-accent bg-accent text-black hover:bg-accent-hover',
  danger: 'border-status-conflict bg-status-conflict-bg text-status-conflict hover:bg-status-conflict/20',
  ghost: 'border-transparent bg-transparent text-secondary-foreground hover:border-border hover:bg-surface-1 hover:text-foreground',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs max-[760px]:h-11',
  md: 'h-10 px-5 text-sm max-[760px]:h-11',
  icon: 'size-10 p-0 max-[760px]:size-11',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  variant = 'default',
  size = 'md',
  type = 'button',
  ...props
}, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-sm border font-display font-semibold transition-colors duration-150 ease-out',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:pointer-events-none disabled:opacity-50',
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  />
));

Button.displayName = 'Button';

export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'aria-label'> {
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>((props, ref) => (
  <Button ref={ref} size="icon" {...props} />
));

IconButton.displayName = 'IconButton';
