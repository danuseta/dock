import React from 'react';
import { cn } from '../lib/cn';

export type PhoneTab = 'runs' | 'archive' | 'retro' | 'library';

interface PhoneTabsProps {
  current: PhoneTab;
  library: boolean;
  counts?: { runs: number; archive: number };
  onPick: (tab: PhoneTab) => void;
}

/** The one tab row of the Agents page on a phone. Above 760 px the page keeps its Office, Retro and Library tabs. */
export const PhoneTabs: React.FC<PhoneTabsProps> = ({ current, library, counts, onPick }) => {
  const tabs: Array<[PhoneTab, string, number | undefined]> = [
    ['runs', 'Runs', counts?.runs],
    ['archive', 'Archive', counts?.archive],
    ...(library ? [['retro', 'Retro', undefined], ['library', 'Library', undefined]] as Array<[PhoneTab, string, undefined]> : []),
  ];
  return (
    <div className="mb-4 hidden flex-wrap gap-1.5 max-[760px]:order-2 max-[760px]:flex" role="tablist" aria-label="Agents">
      {tabs.map(([id, label, count]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={current === id}
          onClick={() => onPick(id)}
          className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-border bg-surface-1 px-3 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150', current === id && 'border-accent bg-accent text-black')}
        >
          {label}{count !== undefined && <span className="font-mono tabular-nums opacity-70">{count}</span>}
        </button>
      ))}
    </div>
  );
};
