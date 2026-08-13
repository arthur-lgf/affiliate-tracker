import { NextResponse, type NextRequest } from 'next/server';
import { credentialsValid, readSessionToken, SESSION_COOKIE } from '@/lib/auth';

/**
 * Sign-in over the admin surface.
 *
 * The dashboard lists lead names, emails and phone numbers, so anything that
 * reads or writes links is gated the moment ADMIN_PASSWORD is set. Public
 * routes — the landing pages, the submission endpoint and the visit beacon —
 * are never gated, or the whole point of the tool would break.
 *
 * Two credentials are accepted:
 *
 *   - the signed session cookie the sign-in form sets, which is what a person
 *     in a browser uses;
 *   - HTTP Basic, which is what this used to require and is kept so a `curl -u`
 *     or an existing script does not break.
 *
 * What is deliberately NOT sent is a `WWW-Authenticate` challenge. That header
 * is what makes a browser throw up its own credential box, and replacing that
 * box with a real page is the point of the sign-in form.
 *
 * With ADMIN_PASSWORD unset (local development) everything is open.
 */

/** Basic credentials, if the header carries any. */
function basicAuthOk(header: string | null): boolean {
  if (!header?.startsWith('Basic ')) return false;

  let decoded: string;
  try {
    // atob yields bytes, not characters. Decoding them as UTF-8 is what makes a
    // password containing any non-ASCII character work at all.
    const bytes = Uint8Array.from(atob(header.slice(6)), (char) => char.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return false;
  }

  const separator = decoded.indexOf(':');
  const user = separator === -1 ? '' : decoded.slice(0, separator);
  const pass = separator === -1 ? decoded : decoded.slice(separator + 1);
  return credentialsValid(user, pass);
}

export async function middleware(request: NextRequest) {
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

  const session = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (session || basicAuthOk(request.headers.get('authorization'))) {
    return NextResponse.next();
  }

  // An API call gets an answer it can parse. Redirecting fetch() to an HTML
  // sign-in page would surface as a JSON parse error rather than "signed out".
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const signIn = new URL('/login', request.url);
  const from = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (from && from !== '/') signIn.searchParams.set('next', from);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Admin pages, link management and lead status changes only. /[slug],
  // /api/submissions and /api/visits are intentionally absent, and so are
  // /login and /api/login — gating the sign-in page behind sign-in is a loop
  // with no way out.
  matcher: [
    '/',
    '/links',
    '/links/:path*',
    // Per-person earnings. Missing from this list, it would be a public page
    // listing what every affiliate is paid.
    '/affiliate',
    '/affiliate/:path*',
    '/api/links',
    '/api/links/:path*',
    '/api/leads',
    '/api/leads/:path*',
    '/api/conversions',
    '/api/conversions/:path*',
  ],
};
