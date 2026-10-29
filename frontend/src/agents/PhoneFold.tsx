import React, { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { usePhone } from './usePhone';

const sectionLabel = 'font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

interface PhoneFoldProps {
  label: ReactNode;
  labelClassName?: string;
  className?: string;
  open?: boolean;
  children: ReactNode;
}

/** A labelled section. Above 760 px it is always open; on a phone its label is a header that folds it. */
export const PhoneFold: React.FC<PhoneFoldProps> = ({ label, labelClassName, className, open = false, children }) => {
  const phone = usePhone();
  const [opened, setOpened] = useState(open);
  if (!phone) {
    return (
      <div className={className}>
        <p className={cn(sectionLabel, 'mb-1', labelClassName)}>{label}</p>
        {children}
      </div>
    );
  }
  return (
    <div className={cn('rounded-[8px] border border-border', className)}>
      <button type="button" className="flex min-h-11 w-full items-center gap-2 border-0 bg-transparent px-3 text-left" aria-expanded={opened} onClick={() => setOpened((value) => !value)}>
        <span className={cn(sectionLabel, labelClassName)}>{label}</span>
        <ChevronDown size={14} aria-hidden="true" className={cn('ml-auto shrink-0 text-muted-foreground transition-transform', !opened && '-rotate-90')} />
      </button>
      {opened && <div className="border-t border-border px-3 pt-1 pb-2">{children}</div>}
    </div>
  );
};
