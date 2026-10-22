import { useCallback, useEffect, useState } from 'react';
import type { Draft } from './questions';

const PREFIX = 'dock.decisions.';

function read(key: string): Record<string, Draft> {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFIX + key) ?? '{}');
    return typeof saved === 'object' && saved !== null ? saved as Record<string, Draft> : {};
  } catch {
    return {};
  }
}

function write(key: string, drafts: Record<string, Draft>) {
  try {
    if (Object.keys(drafts).length) window.localStorage.setItem(PREFIX + key, JSON.stringify(drafts));
    else window.localStorage.removeItem(PREFIX + key);
  } catch {
    // A browser without storage keeps the draft for this visit only.
  }
}

/** The owner's unsent answers for one ticket, kept in this browser until they are submitted. */
export function useDraft(ticketKey: string | null) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => (ticketKey ? read(ticketKey) : {}));

  useEffect(() => { setDrafts(ticketKey ? read(ticketKey) : {}); }, [ticketKey]);

  const update = useCallback((id: string, next: Partial<Draft>) => {
    if (!ticketKey) return;
    setDrafts((current) => {
      const merged = { ...current, [id]: { ...(current[id] ?? { choice: null, text: '', unsure: false }), ...next } };
      write(ticketKey, merged);
      return merged;
    });
  }, [ticketKey]);

  /** Drops the answers of questions that are settled. */
  const clear = useCallback((ids: string[]) => {
    if (!ticketKey) return;
    setDrafts((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id)));
      write(ticketKey, rest);
      return rest;
    });
  }, [ticketKey]);

  /** Keeps the sent answers, read only, until sous settles their questions. */
  const markSent = useCallback((ids: string[]) => {
    if (!ticketKey) return;
    setDrafts((current) => {
      const next = Object.fromEntries(Object.entries(current).map(([id, draft]) => [id, ids.includes(id) ? { ...draft, sent: true } : draft]));
      write(ticketKey, next);
      return next;
    });
  }, [ticketKey]);

  return { drafts, update, clear, markSent };
}
