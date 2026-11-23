// The planning chat of Planning > Draft: the DOCK chat session titled Planning-<sprint>, in the page's right column. Its
// suggestion chips fill the message box with the sprint-planner prompt; the agent changes the draft through the ingest
// routes and the page polls that draft. The column folds to a thin rail and remembers it.
import React from 'react';
import { MessagesSquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '../components/ui';
import { ChatThread } from '../chat/ChatThread';
import { cn } from '../lib/cn';
import type { PlanningSession } from './usePlanningChat';

export const PlanningChat: React.FC<{ session: PlanningSession; folded: boolean; onFold: (folded: boolean) => void; className?: string }> = ({ session, folded, onFold, className }) => {
  if (folded) {
    return (
      <aside aria-label="Planning chat" className={cn('flex min-w-0 flex-col items-center gap-2 rounded-md border border-border bg-surface-0 py-2 max-[1099px]:flex-row max-[1099px]:px-3', className)}>
        <button type="button" onClick={() => onFold(false)} title="Open the planning chat" aria-label="Open the planning chat" className="grid size-8 place-items-center rounded-sm text-secondary-foreground hover:bg-surface-hover hover:text-foreground max-[760px]:size-11">
          <PanelRightOpen size={15} aria-hidden="true" />
        </button>
        <MessagesSquare size={15} className="text-muted-foreground" aria-hidden="true" />
        <span className="hidden truncate font-display text-xs font-semibold text-secondary-foreground max-[1099px]:inline">{session.title}</span>
      </aside>
    );
  }
  return (
    <aside aria-label="Planning chat" className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface-0', className)}>
      <header className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
        <MessagesSquare size={14} className="flex-none text-secondary-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-display text-[0.8rem] font-semibold">{session.title}</span>
        <button type="button" onClick={() => onFold(true)} title="Fold the chat" aria-label="Fold the chat" className="grid size-7 place-items-center rounded-sm text-secondary-foreground hover:bg-surface-hover hover:text-foreground max-[760px]:size-11">
          <PanelRightClose size={14} aria-hidden="true" />
        </button>
      </header>
      {session.error && <p className="flex-none border-b border-border px-3 py-1.5 text-pretty text-xs text-status-conflict" role="alert">{session.error}</p>}
      {session.id ? (
        <ChatThread key={session.id} sessionId={session.id} hideMachine className="min-h-0 flex-1" />
      ) : session.loading ? (
        <p className="p-3 text-sm text-muted-foreground" role="status">Loading the planning chat...</p>
      ) : (
        <div className="grid content-start gap-3 p-3">
          <p className="text-pretty text-sm text-muted-foreground">No planning chat for this sprint yet. Ask the agent to move cards, decide AC references, or draft new tickets.</p>
          <div><Button onClick={() => void session.start()} disabled={session.starting}><MessagesSquare size={14} aria-hidden="true" />{session.starting ? 'Starting...' : 'Start the planning chat'}</Button></div>
        </div>
      )}
    </aside>
  );
};
