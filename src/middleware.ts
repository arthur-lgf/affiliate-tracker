import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optional HTTP Basic auth over the admin surface.
 *
 * The dashboard lists lead names, emails and phone numbers, so anything that
 * reads or writes links is gated the moment ADMIN_PASSWORD is set. Public
 * routes — the landing pages, the submission endpoint and the visit beacon —
 * are never gated, or the whole point of the tool would break.
 *
 * With ADMIN_PASSWORD unset (local development) everything is open.
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized() {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Affiliate Ledger", charset="UTF-8"',
    },
  });
}

export function middleware(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    // Open in development so the app runs with zero configuration. In a
    // production build, refuse to serve the admin surface unpassworded unless
    // that is an explicit, deliberate choice — the alternative is publishing
    // every lead's name, email and phone number to anyone with the URL.
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_OPEN_ADMIN !== 'true') {
      return new NextResponse(
        'Admin access is not configured. Set ADMIN_PASSWORD, or set ALLOW_OPEN_ADMIN=true to run without it.',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }
    return NextResponse.next();
  }

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return unauthorized();

  let decoded: string;
  try {
    // atob yields bytes, not characters. Decoding them as UTF-8 is what makes a
    // password containing any non-ASCII character work at all.
    const bytes = Uint8Array.from(atob(header.slice(6)), (char) => char.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(':');
  const user = separator === -1 ? '' : decoded.slice(0, separator);
  const pass = separator === -1 ? decoded : decoded.slice(separator + 1);

  const expectedUser = process.env.ADMIN_USER || 'admin';
  if (!timingSafeEqual(user, expectedUser) || !timingSafeEqual(pass, password)) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  // Admin pages and link management only. /[slug], /api/submissions and
  // /api/visits are intentionally absent.
  matcher: ['/', '/links', '/links/:path*', '/api/links', '/api/links/:path*'],
};
