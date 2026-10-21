import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpToLine, Copy, ExternalLink, Hand, Link2, MessagesSquare, ArrowUpRight, Unlink } from 'lucide-react';
import { cn } from '../../lib/cn';
import { monitorsOnly, useDockMode } from '../../lib/dockMode';
import { useTicketWork } from './useTicketWork';

export interface TicketMenuTarget {
  /** The ticket is read by key from the latest data, so a poll does not close or stale the menu. */
  key: string;
  x: number;
  y: number;
  /** A long press on a phone opens a bottom sheet instead of a menu at the pointer. */
  sheet: boolean;
}

export interface TicketMenuTicket {
  key: string;
  url?: string | null;
  workOrder?: number | null;
  workOrderSource?: string | null;
  workManual?: boolean | null;
}

interface TicketMenuProps {
  target: TicketMenuTarget;
  ticket: TicketMenuTicket;
  /** The order that makes the cron take this ticket next. */
  nextOrder: number;
  refetchQueries: string[];
  onOpen?: () => void;
  onSession: () => void;
  onDependency?: () => void;
  onDone: (message: string, type: 'success' | 'error') => void;
  onClose: () => void;
}

export const MENU_WIDTH = 248;
const MENU_HEIGHT = 360;

export const TicketMenu: React.FC<TicketMenuProps> = ({ target, ticket, nextOrder, refetchQueries, onOpen, onSession, onDependency, onDone, onClose }) => {
  const root = useRef<HTMLDivElement>(null);
  const [order, setOrder] = useState(ticket.workOrder != null ? String(ticket.workOrder) : '');
  const work = useTicketWork(refetchQueries);
  const monitoring = monitorsOnly(useDockMode());

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')?.focus();
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const run = (action: () => Promise<string>, failed: string) => {
    onClose();
    action().then((message) => onDone(message, 'success'), (error: Error) => onDone(error.message || failed, 'error'));
  };
  const pick = (action: () => void) => {
    onClose();
    action();
  };
  const saveOrder = () => {
    if (!order || (ticket.workOrderSource === 'dock' && String(ticket.workOrder) === order)) return;
    run(() => work.saveOrder(ticket.key, Number(order)), 'Failed to save the work order');
  };

  const item = 'flex w-full items-center gap-2.5 rounded-xs px-2.5 py-2 text-left text-[0.82rem] hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none max-[900px]:min-h-11';
  const items = (
    <>
      <p className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        <span className="text-accent">{ticket.key}</span>
        {!monitoring && <span>{ticket.workManual ? 'Manual' : 'Cron'}{ticket.workOrder != null ? ` · #${ticket.workOrder}` : ''}</span>}
      </p>
      {onOpen && <button type="button" role="menuitem" className={item} onClick={() => pick(onOpen)}><ArrowUpRight size={14} aria-hidden="true" />Open ticket</button>}
      <button type="button" role="menuitem" className={item} onClick={() => pick(onSession)}><MessagesSquare size={14} aria-hidden="true" />Open session</button>
      {!monitoring && <>
      <div className="my-1 h-px bg-border" />
      <p className="px-2.5 pt-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Work order</p>
      <form className="flex items-center gap-1.5 px-2.5 py-1.5" onSubmit={(event) => { event.preventDefault(); saveOrder(); }}>
        <span className="font-mono text-xs text-muted-foreground">#</span>
        <input
          className="h-8 w-16 rounded-xs border border-border-glow bg-surface-0 px-2 font-mono text-sm text-foreground focus-visible:border-accent focus-visible:outline-none max-[900px]:h-11"
          inputMode="numeric"
          value={order}
          placeholder="—"
          aria-label={`Work order for ${ticket.key}`}
          onChange={(event) => setOrder(event.target.value.replace(/[^0-9]/g, ''))}
        />
        <button type="submit" className="h-8 rounded-xs bg-accent px-2.5 text-xs font-bold text-black disabled:opacity-50 max-[900px]:h-11" disabled={!order}>Save</button>
        {ticket.workOrderSource === 'label' && <span className="font-mono text-[0.62rem] text-muted-foreground">Jira label</span>}
      </form>
      <button type="button" role="menuitem" className={item} onClick={() => run(() => work.saveOrder(ticket.key, nextOrder), 'Failed to save the work order')}><ArrowUpToLine size={14} aria-hidden="true" />Work on it next</button>
      {ticket.workOrderSource === 'dock' && <button type="button" role="menuitem" className={item} onClick={() => run(() => work.clearOrder(ticket.key), 'Failed to remove the work order')}><Unlink size={14} aria-hidden="true" />Remove DOCK order</button>}
      <div className="my-1 h-px bg-border" />
      <button type="button" role="menuitemcheckbox" aria-checked={Boolean(ticket.workManual)} className={item} onClick={() => run(() => work.setManual(ticket.key, !ticket.workManual), 'Failed to update manual work')}>
        <Hand size={14} aria-hidden="true" />Work manually
        <span className={cn('relative ml-auto h-4 w-7 rounded-pill transition-colors', ticket.workManual ? 'bg-sky-300' : 'bg-surface-hover')} aria-hidden="true">
          <span className={cn('absolute top-0.5 size-3 rounded-full bg-black/80 transition-[left]', ticket.workManual ? 'left-3.5' : 'left-0.5')} />
        </span>
      </button>
      </>}
      {onDependency && <button type="button" role="menuitem" className={item} onClick={() => pick(onDependency)}><Link2 size={14} aria-hidden="true" />Dependency…</button>}
      <div className="my-1 h-px bg-border" />
      <button type="button" role="menuitem" className={item} onClick={() => run(async () => { await navigator.clipboard.writeText(ticket.key); return `${ticket.key} copied.`; }, 'The key could not be copied')}><Copy size={14} aria-hidden="true" />Copy key</button>
      {ticket.url && <a role="menuitem" className={item} href={ticket.url} target="_blank" rel="noreferrer" onClick={onClose}><ExternalLink size={14} aria-hidden="true" />Open in Jira</a>}
    </>
  );

  if (target.sheet) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/45">
        <div ref={root} role="menu" aria-label={`${ticket.key} actions`} className="absolute inset-x-0 bottom-0 rounded-t-lg border-t border-border-glow bg-surface-1 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-card">
          <span className="mx-auto mb-2 block h-1.5 w-10 rounded-pill bg-border-glow" aria-hidden="true" />
          {items}
        </div>
      </div>
    );
  }
  const left = Math.max(8, Math.min(target.x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(target.y, window.innerHeight - MENU_HEIGHT - 8));
  return (
    <div ref={root} role="menu" aria-label={`${ticket.key} actions`} className="fixed z-[70] rounded-sm border border-border-glow bg-surface-1 p-1 shadow-card" style={{ left, top, width: MENU_WIDTH }}>
      {items}
    </div>
  );
};
