import React from 'react';
import { Info } from 'lucide-react';

/** An ⓘ next to a section title: the rules behind the section, shown on hover or focus. */
export const InfoTip: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <span className="group relative inline-flex align-middle normal-case tracking-normal">
    <button type="button" aria-label={label} className="inline-grid size-5 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:text-foreground max-[760px]:size-8">
      <Info size={12} aria-hidden="true" />
    </button>
    <span role="tooltip" className="pointer-events-none invisible absolute left-0 top-6 z-40 w-[300px] max-w-[calc(100vw-32px)] rounded-md border border-border bg-surface-0 px-3 py-2 text-pretty font-sans text-[0.75rem] font-normal leading-snug text-secondary-foreground opacity-0 shadow-card transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
      {children}
    </span>
  </span>
);
