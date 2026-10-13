/** The four destinations a phone always shows in its bottom bar; every other page sits behind More. */
export const PHONE_PRIMARY_PATHS = ['/', '/dashboard', '/agents', '/sessions'];

interface NavigationItem { path: string; badge: number }

/** What the More button stands for: the pages behind it, the sum of their badges, and whether the current page is one of them. */
export function phoneMore<T extends NavigationItem>(items: T[], currentPath: string): { items: T[]; badge: number; active: boolean } {
  const hidden = items.filter((item) => !PHONE_PRIMARY_PATHS.includes(item.path));
  return {
    items: hidden,
    badge: hidden.reduce((sum, item) => sum + item.badge, 0),
    active: hidden.some((item) => item.path === currentPath),
  };
}
