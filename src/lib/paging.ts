/**
 * Reading a long list a page at a time.
 *
 * One module for it because three screens now do it — the QMP report, the links
 * and the accounts — and a page size that means 25 on one and 50 on another is
 * a difference nobody chose. Pure arithmetic, no React, so a server component
 * can slice a list with the same rules a client one does.
 *
 * scripts/paging-checks.ts holds it to that.
 */

/**
 * The page sizes every list offers, smallest first.
 *
 * Ten leads, and ten is the default everywhere: a list is read a screenful at a
 * time, and a first page you can take in without scrolling beats one that holds
 * everything. The bottom of the list is what pagination is for.
 */
export const PAGE_SIZES = [10, 25, 50, 100, 250] as const;

/** Where a page starts and ends, clamped to what actually exists. */
export function pageBounds(total: number, page: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * perPage + 1;
  const to = Math.min(current * perPage, total);
  return { pages, current, from, to };
}

/**
 * One page of a list.
 *
 * Clamped through pageBounds rather than sliced raw, so a list that shrinks
 * under a filter shows its last page instead of an empty one. That is the whole
 * reason this is a function: every caller holds `page` in state, and none of
 * them hear about it when the list underneath gets shorter.
 */
export function pageSlice<T>(items: T[], page: number, perPage: number): T[] {
  const { current } = pageBounds(items.length, page, perPage);
  return items.slice((current - 1) * perPage, current * perPage);
}
