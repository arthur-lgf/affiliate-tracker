import { NextResponse } from 'next/server';
import { clearedSessionCookieOptions, SESSION_COOKIE } from '@/lib/auth';
import { isSecureRequest } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Sign out — drop the cookie.
 *
 * Not gated: signing out while already signed out is not an error, and there is
 * nothing here to protect. POST rather than GET so a prefetch, an image tag or
 * a crawler cannot sign someone out by following a link.
 */
export async function POST(request: Request) {
  // Cleared with the same attributes it was set with. A cookie whose Secure or
  // Path differs from the original is a *different* cookie to the browser, so
  // the old one would survive the click that was supposed to remove it.
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', clearedSessionCookieOptions(isSecureRequest(request)));
  return response;
}
