import { createContext, useContext } from 'react';

export type DockMode = 'laptop' | 'workspace';

const MISSING_PAGES: Record<DockMode, string[]> = {
  laptop: ['/sessions', '/demo-videos', '/dev-servers'],
  workspace: ['/monitoring', '/docker'],
};

export const hasPage = (mode: DockMode, path: string) => !MISSING_PAGES[mode].includes(path);

export const showsChatDock = (mode: DockMode, currentPath: string) => hasPage(mode, '/sessions') && !currentPath.startsWith('/sessions');

export const DockModeContext = createContext<DockMode>('laptop');

export const useDockMode = () => useContext(DockModeContext);
