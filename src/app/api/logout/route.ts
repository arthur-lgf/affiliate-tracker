import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Sign out — drop the cookie.
 *
 * Not gated: signing out while already signed out is not an error, and there is
 * nothing here to protect. POST rather than GET so a prefetch, an image tag or
 * a crawler cannot sign someone out by following a link.
 */
export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge: 0,
  });
  return response;
}
