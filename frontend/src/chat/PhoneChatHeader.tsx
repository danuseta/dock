import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, MoreVertical, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import type { DotState } from './headerState';
import { LimitBars, LimitMeters } from './StatusLine';
import { StatusDot } from './StatusDot';
import { useChatStatus } from './useChatStatus';

export interface PhoneMenuItem { label: string; icon: LucideIcon; onSelect: () => void; disabled?: boolean }

interface PhoneChatHeaderProps {
  title: string;
  line: string;
  dot?: DotState;
  machine?: string;
  menu?: PhoneMenuItem[];
  onBack?: () => void;
  onMinimise: () => void;
  /** Shown under the header row, for example the rename box. */
  children?: React.ReactNode;
}

const iconButton = 'grid size-11 min-[700px]:size-9 flex-none place-items-center rounded-xs text-secondary-foreground hover:bg-surface-1 hover:text-foreground';

/** The chat panel's one header on a phone: back, title with its state, the usage limits, a menu and minimise. */
export const PhoneChatHeader: React.FC<PhoneChatHeaderProps> = ({ title, line, dot, machine, menu, onBack, onMinimise, children }) => {
  const { status } = useChatStatus(machine);
  const limits = status?.limits;
  const hasLimits = Boolean(limits && (limits.fiveHour || limits.sevenDay));
  const [usageOpen, setUsageOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  return (
    <div
      ref={root}
      className="relative flex flex-none flex-col border-b border-border bg-surface-0"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !menuOpen) return;
        event.stopPropagation();
        setMenuOpen(false);
      }}
    >
      <header className="flex items-center gap-0.5 px-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1.5">
        {onBack ? <button type="button" className={iconButton} aria-label="Back to sessions" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /></button> : <span className="w-2 flex-none" />}
        <div className="min-w-0 flex-1 px-1">
          <h2 className="truncate font-display text-[0.95rem] font-bold" title={title}>{title}</h2>
          <p className="flex min-w-0 items-center gap-1.5 font-mono text-[0.66rem] text-muted-foreground">
            {dot && <StatusDot state={dot} className="size-2" />}
            <span className="truncate">{line}</span>
          </p>
        </div>
        {hasLimits && (
          <button type="button" className={cn(iconButton, usageOpen && 'bg-surface-1')} aria-expanded={usageOpen} aria-label={usageOpen ? 'Hide Claude usage' : 'Show Claude usage'} onClick={() => setUsageOpen((current) => !current)}>
            <LimitBars machine={machine} />
          </button>
        )}
        {menu && menu.length > 0 && (
          <button type="button" className={cn(iconButton, menuOpen && 'bg-surface-1 text-foreground')} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Session menu" onClick={() => setMenuOpen((current) => !current)}>
            <MoreVertical size={16} aria-hidden="true" />
          </button>
        )}
        <button type="button" className={iconButton} aria-label="Minimise chat" onClick={onMinimise}><ChevronDown size={18} aria-hidden="true" /></button>
      </header>
      {usageOpen && hasLimits && (
        <div className="flex flex-col gap-2 border-t border-border px-3.5 py-3">
          <span className="font-mono text-[0.62rem] font-bold tracking-[0.1em] text-muted-foreground">CLAUDE USAGE</span>
          <LimitMeters machine={machine} />
        </div>
      )}
      {children}
      {menuOpen && menu && (
        <div role="menu" aria-label="Session actions" className="absolute top-full right-2 z-30 mt-1 flex w-52 flex-col rounded-sm border border-border-glow bg-surface-1 p-1 shadow-card">
          {menu.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="flex h-11 items-center gap-2.5 rounded-xs px-2.5 text-left text-[0.8rem] text-foreground hover:bg-surface-2 disabled:opacity-50"
              onClick={() => { setMenuOpen(false); item.onSelect(); }}
            >
              <item.icon size={15} aria-hidden="true" className="flex-none text-secondary-foreground" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
