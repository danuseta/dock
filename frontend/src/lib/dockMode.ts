import { createContext, useContext } from 'react';

export type DockMode = 'laptop' | 'workspace';

const MISSING_PAGES: Record<DockMode, string[]> = {
  laptop: ['/blackboard', '/sessions', '/demo-videos', '/dev-servers', '/machines', '/health', '/discord'],
  workspace: ['/monitoring', '/docker', '/calendar'],
};

export const hasPage = (mode: DockMode, path: string) => !MISSING_PAGES[mode].includes(path);

export const showsChatDock = (mode: DockMode, currentPath: string) => hasPage(mode, '/sessions') && !currentPath.startsWith('/sessions');

/** The laptop DOCK on the VPS only monitors its runs: it offers no agent control. */
export const monitorsOnly = (mode: DockMode) => mode === 'laptop';

export const DockModeContext = createContext<DockMode>('laptop');

export const useDockMode = () => useContext(DockModeContext);
