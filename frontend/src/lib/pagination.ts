export interface PageSlice<T> {
  items: T[];
  page: number;
  pages: number;
}

/** One page of a list, 1-based; a page past the end clamps to the last page, so a delete never leaves an empty page. */
export function paginate<T>(items: readonly T[], page: number, size: number): PageSlice<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: items.slice((current - 1) * size, current * size), page: current, pages };
}
