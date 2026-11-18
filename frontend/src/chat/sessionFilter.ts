import type { SessionFilter } from './sessionGroups';

const FILTER_KEY = 'jidis.sessions-filter';

export function readSessionFilter(): SessionFilter {
  try {
    const value = window.localStorage.getItem(FILTER_KEY);
    return value === 'task' || value === 'review' || value === 'work' || value === 'gm' ? value : 'all';
  } catch {
    return 'all';
  }
}

export function writeSessionFilter(filter: SessionFilter) {
  try { window.localStorage.setItem(FILTER_KEY, filter); } catch { /* the choice lasts until the page closes */ }
}
