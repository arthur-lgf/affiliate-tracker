/**
 * Who is asking, for a page.
 *
 * Uses cookies(), headers() and redirect(), all of which belong to the React
 * Server Component layer — which is exactly why route handlers get their own
 * entry point in lib/api-auth.ts instead of importing this. The shared logic
 * lives in lib/viewer-core.ts, so "is this session still valid" is written once.
 */

import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authConfigured, readSessionToken, SESSION_COOKIE } from './auth';
import { openViewer, readBasic, resolveSession, type Viewer } from './viewer-core';

export type { Viewer } from './viewer-core';
export { isAdmin } from './viewer-core';

/**
 * Memoised for the life of one request by React's cache(). The layout and the
 * page it wraps both need the viewer, and without this every render would spend
 * a second round trip to Postgres asking the same question.
 */
export const currentViewer = cache(async (): Promise<Viewer | null> => {
  if (!authConfigured()) return openViewer();

  const headerBag = await headers();
  const basic = readBasic(headerBag.get('authorization'));
  if (basic) return basic;

  const jar = await cookies();
  const session = await readSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return resolveSession(session);
});

/** For a page that any signed-in person may open. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect('/login');
  return viewer;
}

/**
 * For a page only an admin may open.
 *
 * Sends an affiliate to their own dashboard rather than to an error: these
 * pages are not in their navigation, so arriving at one means a stale bookmark
 * or a typed URL far more often than it means an attempt at something.
 */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.role !== 'admin') redirect('/');
  return viewer;
}
