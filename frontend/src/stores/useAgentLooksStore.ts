import { create } from 'zustand';
import type { StoredAgentLook } from '../chat/activity/transcript';

export interface AgentLookRow { slug: string; displayName: string | null; initials: string | null; color: string | null; avatarUrl: string | null }

interface AgentLooksState {
  rows: AgentLookRow[];
  looks: Record<string, StoredAgentLook>;
  setRows: (rows: AgentLookRow[], origin: string) => void;
}

/** The looks saved in DOCK, by slug, with avatar URLs made absolute for the API origin. */
export const useAgentLooksStore = create<AgentLooksState>((set) => ({
  rows: [],
  looks: {},
  setRows: (rows, origin) => set({
    rows,
    looks: Object.fromEntries(rows.map((row) => [row.slug, { initials: row.initials, color: row.color, avatarUrl: row.avatarUrl ? `${origin}${row.avatarUrl}` : null }])),
  }),
}));
