import { useEffect, useRef } from 'react';

const DRAFT_DELAY = 400;

const draftKey = (sessionId: string): string => `dock-chat-draft:${sessionId}`;

export const readDraft = (sessionId: string): string => {
  try { return window.localStorage.getItem(draftKey(sessionId)) ?? ''; } catch { return ''; }
};

export const writeDraft = (sessionId: string, text: string): void => {
  try {
    if (text) window.localStorage.setItem(draftKey(sessionId), text);
    else window.localStorage.removeItem(draftKey(sessionId));
  } catch { return; }
};

export const useDraftSaver = (sessionId: string, text: string): void => {
  const latest = useRef(text);
  useEffect(() => { latest.current = text; }, [text]);
  useEffect(() => {
    const timer = window.setTimeout(() => writeDraft(sessionId, text), DRAFT_DELAY);
    return () => window.clearTimeout(timer);
  }, [sessionId, text]);
  useEffect(() => () => writeDraft(sessionId, latest.current), [sessionId]);
};
