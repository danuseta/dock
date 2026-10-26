import React, { useState } from 'react';
import { useMutation } from '@apollo/client';
import { Pencil } from 'lucide-react';
import { RENAME_CHAT_SESSION } from '../graphql/mutations';
import { Button, Input } from '../components/ui';
import type { ChatSession } from './messages';

const TITLE_MAX = 120;

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

interface SessionHeaderProps {
  session: ChatSession;
  /** The Sessions page has its own title and rename control. */
  showTitle: boolean;
  /** Opens with the title already in the rename box; saving or cancelling then calls `onDone`. */
  startEditing?: boolean;
  onDone?: () => void;
}

export const SessionHeader: React.FC<SessionHeaderProps> = ({ session, showTitle, startEditing, onDone }) => {
  const [rename, { loading: renaming }] = useMutation(RENAME_CHAT_SESSION);
  const [titleDraft, setDraft] = useState<string | null>(startEditing ? session.title : null);
  const setTitleDraft = (value: string | null) => {
    setDraft(value);
    if (value === null) onDone?.();
  };
  const [error, setError] = useState('');

  if (session.source !== 'dock' || !showTitle) return null;

  const saveTitle = async () => {
    const title = (titleDraft ?? '').trim();
    if (!title) return;
    setError('');
    try {
      await rename({ variables: { id: session.id, title } });
      setTitleDraft(null);
    } catch (renameError) {
      setError(messageOf(renameError, 'The session could not be renamed'));
    }
  };

  return (
    <div className="flex flex-none flex-col border-b border-border bg-surface-0">
      <div className="flex min-w-0 items-center gap-1.5 px-3.5 py-1.5">
        {titleDraft === null ? (
          <>
            <span className="min-w-0 truncate font-display text-xs font-bold" title={session.title}>{session.title || session.ticketKey || 'Untitled session'}</span>
            <Button size="sm" variant="ghost" className="h-6 flex-none px-1.5 max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Rename session" title="Rename" onClick={() => setTitleDraft(session.title)}><Pencil size={12} aria-hidden="true" /></Button>
          </>
        ) : (
          <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
            <Input className="h-8 min-w-0 flex-1 px-2.5 text-xs max-[900px]:h-11" value={titleDraft} maxLength={TITLE_MAX} aria-label="Session title" autoFocus onChange={(event) => setTitleDraft(event.target.value)} />
            <Button size="sm" type="submit" variant="primary" className="max-[900px]:h-11" disabled={renaming || !titleDraft.trim()}>Save</Button>
            <Button size="sm" variant="ghost" className="max-[900px]:h-11" onClick={() => setTitleDraft(null)}>Cancel</Button>
          </form>
        )}
      </div>
      {error && <p className="border-t border-border px-3.5 py-1.5 text-pretty text-xs break-words text-status-conflict" role="alert">{error}</p>}
    </div>
  );
};
