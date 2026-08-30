import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const controlClass = [
  'w-full rounded-sm border border-border bg-surface-0 px-4 font-body text-sm text-foreground',
  'placeholder:text-muted-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
  'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-status-conflict aria-invalid:ring-status-conflict/30',
].join(' ');

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
  contentClassName?: string;
  id?: string;
  'aria-label': string;
  'aria-describedby'?: string;
}

export const Select = ({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  disabled,
  name,
  className,
  contentClassName,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: SelectProps) => (
  <SelectPrimitive.Root
    value={value}
    defaultValue={defaultValue}
    onValueChange={onValueChange}
    disabled={disabled}
    name={name}
  >
    <SelectPrimitive.Trigger
      id={id}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={cn(
        controlClass,
        'flex h-10 items-center justify-between gap-3 pr-3 text-left data-[placeholder]:text-muted-foreground',
        className,
      )}
    >
      <SelectPrimitive.Value placeholder={placeholder} />
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        align="start"
        sideOffset={4}
        className={cn(
          'z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface-1 p-1 text-foreground shadow-card',
          contentClassName,
        )}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center text-muted-foreground">
          <ChevronUp className="size-4" aria-hidden="true" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport>
          {options.map((option) => (
            <SelectPrimitive.Item
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="relative flex min-h-9 cursor-default select-none items-center rounded-sm py-2 pr-9 pl-3 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground"
            >
              <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              <SelectPrimitive.ItemIndicator className="absolute right-3 inline-flex items-center text-accent">
                <Check className="size-4" aria-hidden="true" />
              </SelectPrimitive.ItemIndicator>
            </SelectPrimitive.Item>
          ))}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center text-muted-foreground">
          <ChevronDown className="size-4" aria-hidden="true" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
);

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
