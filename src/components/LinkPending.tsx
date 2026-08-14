'use client';

import { useLinkStatus } from 'next/link';
import { Spinner } from './Spinner';

/**
 * "This link is loading", shown on the link itself.
 *
 * Only useful for a link that changes the query string rather than the route —
 * the period and person filters. A route change swaps in that segment's
 * loading.tsx the instant it is clicked, so it says so for itself; a filter
 * change re-renders the same page on the server with the old screen left in
 * place, and without this nothing at all happens for as long as the query
 * takes. That is the case people click twice.
 *
 * Rendered as an overlay rather than an extra element in the row, so nothing
 * moves when it appears. A control that resizes under a finger that is still
 * on it is worse than no indicator. Must be a child of the <Link> it belongs
 * to; useLinkStatus reads it from context.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      className="absolute inset-0 flex items-center justify-center rounded-full"
      style={{ background: 'color-mix(in srgb, var(--color-panel) 78%, transparent)' }}
    >
      <Spinner />
    </span>
  );
}
