import { NextResponse } from 'next/server';
import {
  authConfigured,
  createSessionToken,
  credentialsValid,
  SESSION_COOKIE,
  safeNextPath,
  sessionCookieOptions,
} from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Sign in.
 *
 * Deliberately outside the middleware matcher — gating this behind a session
 * would mean needing a session to get a session.
 */
export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: 'No password is configured, so there is nothing to sign in to.' },
      { status: 503 },
    );
  }

  // A password guess is cheap to make and expensive to get wrong, so this is
  // tighter than the lead form: 8 tries per IP per 10 minutes.
  const ip = clientIp(request as unknown as { headers: Headers });
  const limit = rateLimit(`login:${ip || 'unknown'}`, { limit: 8, windowMs: 10 * 60_000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { username, password, next } = (body ?? {}) as Record<string, unknown>;
  const user = typeof username === 'string' ? username.trim() : '';
  const secret = typeof password === 'string' ? password : '';

  if (!credentialsValid(user, secret)) {
    // One message for both fields: saying which half was wrong tells an
    // attacker when they have found the username.
    return NextResponse.json({ error: 'That username and password do not match.' }, { status: 401 });
  }

  const redirectTo = safeNextPath(typeof next === 'string' ? next : null);
  const token = await createSessionToken(user);

  const response = NextResponse.json({ ok: true, redirectTo });
  response.cookies.set(
    SESSION_COOKIE,
    token,
    // Secure only over HTTPS: a `secure` cookie is silently dropped on plain
    // http://, which would make sign-in fail with no visible error on a LAN
    // deployment or over a tunnel.
    sessionCookieOptions(new URL(request.url).protocol === 'https:'),
  );
  return response;
}
