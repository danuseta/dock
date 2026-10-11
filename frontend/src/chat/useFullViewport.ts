import { useEffect } from 'react';

export function useFullViewport(enabled: boolean, query: string) {
  useEffect(() => {
    if (!enabled) return undefined;
    const media = window.matchMedia(query);
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const sync = () => {
      root.style.setProperty('--vv-h', `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty('--vv-top', `${viewport?.offsetTop ?? 0}px`);
    };
    const apply = () => {
      if (!media.matches) {
        root.style.removeProperty('--vv-h');
        root.style.removeProperty('--vv-top');
        root.style.overflow = '';
        return;
      }
      root.style.overflow = 'hidden';
      sync();
    };
    apply();
    media.addEventListener('change', apply);
    viewport?.addEventListener('resize', sync);
    viewport?.addEventListener('scroll', sync);
    return () => {
      media.removeEventListener('change', apply);
      viewport?.removeEventListener('resize', sync);
      viewport?.removeEventListener('scroll', sync);
      root.style.removeProperty('--vv-h');
      root.style.removeProperty('--vv-top');
      root.style.overflow = '';
    };
  }, [enabled, query]);
}
