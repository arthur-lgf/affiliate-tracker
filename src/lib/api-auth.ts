/**
 * Who is asking, for a route handler.
 *
 * The page-side equivalent is lib/viewer.ts. They are separate modules on
 * purpose: viewer.ts reaches for cookies(), headers() and redirect(), which
 * belong to the React Server Component layer, and importing that module from a
 * route handler leaves the build unable to collect the route. Both sides share
 * lib/viewer-core.ts, so there is still exactly one implementation of "is this
 * session still valid".
 */

import { NextResponse } from 'next/server';
import { authConfigured, readSessionToken, SESSION_COOKIE } from './auth';
import { cookieValue, openViewer, readBasic, resolveSession, type Viewer } from './viewer-core';

export type { Viewer } from './viewer-core';

/**
 * Resolve the caller, or null.
 *
 * Every gated route calls this rather than trusting the middleware. The
 * middleware proved the request carries a signed, unexpired cookie; only this
 * knows whether the account behind it is still active, still an admin, and
 * still bound to the tracking key the cookie claims.
 */
export async function viewerFromRequest(request: Request): Promise<Viewer | null> {
  if (!authConfigured()) return openViewer();

  const basic = readBasic(request.headers.get('authorization'));
  if (basic) return basic;

  const session = await readSessionToken(cookieValue(request.headers.get('cookie'), SESSION_COOKIE));
  if (!session) return null;
  return resolveSession(session);
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
}

export function forbidden(message = 'That is not yours to change.'): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * The common shape: signed in, and an admin.
 *
 * Returns the viewer on success or the response to send on failure, so a route
 * cannot accidentally continue past a refusal — there is nothing to forget to
 * check, because the failure case is a value it has to return.
 */
export async function requireApiAdmin(
  request: Request,
  message?: string,
): Promise<{ viewer: Viewer } | { response: NextResponse }> {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return { response: unauthorized() };
  if (viewer.role !== 'admin') return { response: forbidden(message) };
  return { viewer };
}
