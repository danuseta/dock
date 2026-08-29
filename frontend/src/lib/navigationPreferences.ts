export type NavigationMode = 'left' | 'right' | 'top' | 'bottom';

export interface NavigationPreferences {
  mode: NavigationMode;
  collapsed: boolean;
}

export const NAVIGATION_PREFERENCES_EVENT = 'jidis:navigation-preferences';
const STORAGE_KEY = 'jidis.navigation-preferences';
const defaults: NavigationPreferences = { mode: 'left', collapsed: false };

export const readNavigationPreferences = (): NavigationPreferences => {
  if (typeof window === 'undefined') return defaults;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    const mode = ['left', 'right', 'top', 'bottom'].includes(saved.mode) ? saved.mode : defaults.mode;
    return { mode, collapsed: typeof saved.collapsed === 'boolean' ? saved.collapsed : defaults.collapsed };
  } catch {
    return defaults;
  }
};

export const saveNavigationPreferences = (preferences: NavigationPreferences) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent<NavigationPreferences>(NAVIGATION_PREFERENCES_EVENT, { detail: preferences }));
};
