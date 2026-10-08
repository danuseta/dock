import { useSyncExternalStore } from 'react';

export type ChatMode = 'closed' | 'float' | 'drawer';

export interface ChatState {
  mode: ChatMode;
  /** The shape the chat takes the next time it is opened from the round button. */
  openMode: 'float' | 'drawer';
  tabs: string[];
  active: string | null;
  drawerHeight: number;
  lastSeen: Record<string, number>;
}

export const CHAT_STATE_KEY = 'dock-chat-state';
export const DRAWER_MIN_HEIGHT = 200;
export const DRAWER_MAX_RATIO = 0.8;

export const initialChatState: ChatState = { mode: 'closed', openMode: 'float', tabs: [], active: null, drawerHeight: 340, lastSeen: {} };

export function openSession(state: ChatState, id: string): ChatState {
  return {
    ...state,
    mode: state.mode === 'closed' ? state.openMode : state.mode,
    tabs: state.tabs.includes(id) ? state.tabs : [...state.tabs, id],
    active: id,
  };
}

export function closeTab(state: ChatState, id: string): ChatState {
  const index = state.tabs.indexOf(id);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab !== id);
  const lastSeen = { ...state.lastSeen };
  delete lastSeen[id];
  return { ...state, tabs, lastSeen, active: state.active === id ? tabs[Math.min(index, tabs.length - 1)] ?? null : state.active };
}

export function setMode(state: ChatState, mode: ChatMode): ChatState {
  if (mode === state.mode) return state;
  return { ...state, mode, openMode: mode === 'closed' ? state.openMode : mode };
}

export function setActive(state: ChatState, id: string): ChatState {
  return state.tabs.includes(id) && state.active !== id ? { ...state, active: id } : state;
}

export function markSeen(state: ChatState, sessionId: string, messageId: number): ChatState {
  if (!state.tabs.includes(sessionId) || messageId <= (state.lastSeen[sessionId] ?? 0)) return state;
  return { ...state, lastSeen: { ...state.lastSeen, [sessionId]: messageId } };
}

export const clampDrawerHeight = (height: number, viewportHeight: number) => Math.round(
  Math.max(DRAWER_MIN_HEIGHT, Math.min(height, Math.max(DRAWER_MIN_HEIGHT, viewportHeight * DRAWER_MAX_RATIO))),
);

export function setDrawerHeight(state: ChatState, height: number, viewportHeight: number): ChatState {
  const drawerHeight = clampDrawerHeight(height, viewportHeight);
  return drawerHeight === state.drawerHeight ? state : { ...state, drawerHeight };
}

/** Rebuilds a state from whatever was stored: anything missing or malformed falls back to the default. */
export function parseChatState(raw: string | null): ChatState {
  try {
    const saved = JSON.parse(raw || '{}');
    const tabs = Array.isArray(saved.tabs) ? [...new Set(saved.tabs.filter((tab: unknown): tab is string => typeof tab === 'string' && tab !== ''))] as string[] : [];
    const lastSeen: Record<string, number> = {};
    if (saved.lastSeen && typeof saved.lastSeen === 'object') {
      for (const [id, value] of Object.entries(saved.lastSeen)) if (typeof value === 'number' && tabs.includes(id)) lastSeen[id] = value;
    }
    return {
      mode: saved.mode === 'float' || saved.mode === 'drawer' ? saved.mode : 'closed',
      openMode: saved.openMode === 'drawer' ? 'drawer' : 'float',
      tabs,
      active: typeof saved.active === 'string' && tabs.includes(saved.active) ? saved.active : tabs[0] ?? null,
      drawerHeight: typeof saved.drawerHeight === 'number' && saved.drawerHeight >= DRAWER_MIN_HEIGHT ? saved.drawerHeight : initialChatState.drawerHeight,
      lastSeen,
    };
  } catch {
    return initialChatState;
  }
}

const read = (): ChatState => {
  try {
    return parseChatState(window.localStorage.getItem(CHAT_STATE_KEY));
  } catch {
    return initialChatState;
  }
};

let state = read();
const listeners = new Set<() => void>();

const update = (next: ChatState) => {
  if (next === state) return;
  state = next;
  try {
    window.localStorage.setItem(CHAT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Without storage the chat still works; it only forgets its tabs on reload.
  }
  for (const listener of listeners) listener();
};

export const chatStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => state,
  openSession: (id: string) => update(openSession(state, id)),
  closeTab: (id: string) => update(closeTab(state, id)),
  setMode: (mode: ChatMode) => update(setMode(state, mode)),
  setActive: (id: string) => update(setActive(state, id)),
  markSeen: (sessionId: string, messageId: number) => update(markSeen(state, sessionId, messageId)),
  setDrawerHeight: (height: number) => update(setDrawerHeight(state, height, window.innerHeight)),
};

export const useChatState = () => useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getSnapshot);
