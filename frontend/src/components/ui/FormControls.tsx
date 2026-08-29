import { Check, ChevronDown } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const controlClass = [
  'w-full rounded-sm border border-border bg-surface-0 px-4 font-body text-sm text-foreground',
  'placeholder:text-muted-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
  'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-status-conflict aria-invalid:ring-status-conflict/30',
].join(' ');

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => (
  <span className="relative block">
    <select ref={ref} className={cn(controlClass, 'h-10 appearance-none pr-10', className)} {...props} />
    <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
  </span>
));

Select.displayName = 'Select';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(controlClass, 'min-h-24 resize-y py-3', className)} {...props} />
));

Textarea.displayName = 'Textarea';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...props }, ref) => (
  <span className="relative grid size-5 shrink-0 place-items-center">
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'peer size-5 appearance-none rounded-sm border border-border bg-surface-0',
        'checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
    <Check className="pointer-events-none absolute size-3.5 text-black opacity-0 peer-checked:opacity-100" strokeWidth={3} aria-hidden="true" />
  </span>
));

Checkbox.displayName = 'Checkbox';
