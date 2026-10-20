import React, { useEffect, useRef } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { cn } from '../lib/cn';
import { sessionTitle, type ChatSession } from './messages';

export interface SessionMenuTarget {
  session: ChatSession;
  x: number;
  y: number;
  /** A long press on a phone opens a bottom sheet instead of a menu at the pointer. */
  sheet: boolean;
}

interface SessionMenuProps {
  target: SessionMenuTarget;
  onRename: (session: ChatSession) => void;
  onDelete: (session: ChatSession) => void;
  onClose: () => void;
}

const MENU_WIDTH = 200;
const MENU_HEIGHT = 110;

export const SessionMenu: React.FC<SessionMenuProps> = ({ target, onRename, onDelete, onClose }) => {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
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

  const pick = (action: (session: ChatSession) => void) => {
    onClose();
    action(target.session);
  };
  const item = 'flex w-full items-center gap-2.5 rounded-xs px-2.5 py-2 text-left text-[0.82rem] hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none max-[900px]:min-h-11';
  const items = (
    <>
      <p className="truncate px-2.5 pb-1 pt-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">{sessionTitle(target.session)}</p>
      <button type="button" role="menuitem" className={item} onClick={() => pick(onRename)}><Pencil size={14} aria-hidden="true" />Rename</button>
      <div className="my-1 h-px bg-border" />
      <button type="button" role="menuitem" className={cn(item, 'text-status-conflict')} onClick={() => pick(onDelete)}><Trash2 size={14} aria-hidden="true" />Delete session</button>
    </>
  );

  if (target.sheet) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/45">
        <div ref={root} role="menu" aria-label="Session actions" className="absolute inset-x-0 bottom-0 rounded-t-lg border-t border-border-glow bg-surface-1 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-card">
          <span className="mx-auto mb-2 block h-1.5 w-10 rounded-pill bg-border-glow" aria-hidden="true" />
          {items}
        </div>
      </div>
    );
  }
  const left = Math.min(target.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(target.y, window.innerHeight - MENU_HEIGHT - 8);
  return (
    <div ref={root} role="menu" aria-label="Session actions" className="fixed z-[70] rounded-sm border border-border-glow bg-surface-1 p-1 shadow-card" style={{ left, top, width: MENU_WIDTH }}>
      {items}
    </div>
  );
};
