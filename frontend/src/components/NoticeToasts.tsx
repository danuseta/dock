import React from 'react';
import { Bell, X } from 'lucide-react';
import { useNotices } from '../lib/notices';

/** The notifications of the page in view, top right on a computer and across the top on a phone; a click opens what it is about. */
export const NoticeToasts: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const notices = useNotices((state) => state.notices);
  const dismiss = useNotices((state) => state.dismiss);
  if (notices.length === 0) return null;
  return (
    <ul className="fixed top-[max(16px,env(safe-area-inset-top))] right-4 z-[60] m-0 flex w-[min(360px,calc(100vw-32px))] list-none flex-col gap-2 p-0" aria-live="polite">
      {notices.map((notice) => (
        <li key={notice.id} className="flex items-start gap-1 rounded-md border border-border-glow bg-surface-1 shadow-card">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-2.5 py-2.5 pl-3 text-left max-[760px]:min-h-11"
            onClick={() => { dismiss(notice.id); onNavigate(notice.url); }}
          >
            <Bell size={15} aria-hidden="true" className="mt-0.5 flex-none text-accent" />
            <span className="min-w-0">
              <b className="block truncate font-display text-[0.8rem] font-semibold text-foreground">{notice.title}</b>
              {notice.body && <span className="line-clamp-2 text-[0.74rem] text-secondary-foreground">{notice.body}</span>}
            </span>
          </button>
          <button type="button" className="grid size-9 flex-none place-items-center rounded-xs text-muted-foreground hover:text-foreground max-[760px]:size-11" aria-label="Dismiss" onClick={() => dismiss(notice.id)}>
            <X size={14} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
};
