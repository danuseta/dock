import { createContext, useContext } from 'react';

export type DockMode = 'laptop' | 'workspace';

/** The pages each DOCK leaves out: the laptop one has no chat and no dev servers, the workspace one has no calendar and no Docker. */
const MISSING_PAGES: Record<DockMode, string[]> = {
  laptop: ['/sessions', '/dev-servers'],
  workspace: ['/calendar', '/docker'],
};

export const hasPage = (mode: DockMode, path: string) => !MISSING_PAGES[mode].includes(path);

export const DockModeContext = createContext<DockMode>('laptop');

export const useDockMode = () => useContext(DockModeContext);
