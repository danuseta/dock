import { create } from 'zustand';

/** A notification shown inside the page while DOCK is in view, where the browser shows none. */
export interface Notice { id: string; title: string; body: string; url: string }

const SHOWN = 3;
export const NOTICE_MS = 8000;

interface NoticeState {
  notices: Notice[];
  show: (notice: Omit<Notice, 'id'>) => void;
  dismiss: (id: string) => void;
}

let next = 0;

export const useNotices = create<NoticeState>((set) => ({
  notices: [],
  show: (notice) => {
    const id = `notice-${(next += 1)}`;
    set((state) => ({ notices: [...state.notices, { ...notice, id }].slice(-SHOWN) }));
    setTimeout(() => set((state) => ({ notices: state.notices.filter((item) => item.id !== id) })), NOTICE_MS);
  },
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((item) => item.id !== id) })),
}));

export const showNotice = (notice: Omit<Notice, 'id'>) => useNotices.getState().show(notice);

/** The title, text and link of a push the service worker handed to a page in view; null for anything else. */
export function noticeFromPush(message: unknown): Omit<Notice, 'id'> | null {
  const sent = message as { type?: unknown; title?: unknown; body?: unknown; url?: unknown } | null;
  if (sent?.type !== 'dock-push' || typeof sent.title !== 'string' || !sent.title) return null;
  return { title: sent.title, body: typeof sent.body === 'string' ? sent.body : '', url: typeof sent.url === 'string' && sent.url.startsWith('/') ? sent.url : '/' };
}
