import { NextResponse } from 'next/server';
import {
  adminUser,
  authConfigured,
  createSessionToken,
  ENV_ADMIN_ID,
  envCredentialsValid,
  SESSION_COOKIE,
  safeNextPath,
  sessionCookieOptions,
} from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp, isSecureRequest } from '@/lib/request';
import { normalizeUsername, usersEnabled, verifyLogin } from '@/lib/users';

export const dynamic = 'force-dynamic';

/**
 * Sign in.
 *
 * Deliberately outside the middleware matcher — gating this behind a session
 * would mean needing a session to get a session.
 *
 * Two account sources, checked in this order:
 *
 *   1. ADMIN_USER / ADMIN_PASSWORD from the environment. Always an admin.
 *      Checked first so it still works when the database is down, which is the
 *      entire reason it still exists.
 *   2. The users table, for everyone an admin has since created.
 */
export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      {
        error:
          'Sign-in is not set up on this deployment. Set SESSION_SECRET (and ADMIN_PASSWORD, if you want the built-in admin).',
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { username, password, next } = (body ?? {}) as Record<string, unknown>;
  const rawUser = typeof username === 'string' ? username.trim() : '';
  const secret = typeof password === 'string' ? password : '';
  const user = normalizeUsername(rawUser);

  // Two limiters, because they stop different attacks. The per-IP one blunts
  // someone spraying many passwords from one place; the per-username one blunts
  // a distributed attempt on one known account, which the IP limit never sees.
  const ip = clientIp(request as unknown as { headers: Headers });
  for (const [key, limit] of [
    [`login:ip:${ip || 'unknown'}`, 8],
    [`login:user:${user || 'unknown'}`, 10],
  ] as const) {
    const check = rateLimit(key, { limit, windowMs: 10 * 60_000 });
    if (!check.ok) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${check.retryAfterSeconds} seconds.` },
        { status: 429, headers: { 'retry-after': String(check.retryAfterSeconds) } },
      );
    }
  }

  // One message for every failure below: saying which half was wrong, or that
  // an account exists but is disabled, tells an attacker when they have found
  // a real username.
  const rejected = NextResponse.json(
    { error: 'That username and password do not match.' },
    { status: 401 },
  );

  let subject: Parameters<typeof createSessionToken>[0] | null = null;

  if (envCredentialsValid(user, secret)) {
    subject = {
      uid: ENV_ADMIN_ID,
      user: adminUser().toLowerCase(),
      role: 'admin',
      usr: '',
      pwdAt: 0,
    };
  } else if (usersEnabled() && user) {
    let account = null;
    try {
      account = await verifyLogin(user, secret);
    } catch {
      // A database that cannot be reached is not a bad password, and saying so
      // saves an hour of retyping a password that was right all along.
      return NextResponse.json(
        { error: 'Could not reach the account database. Try again in a moment.' },
        { status: 503 },
      );
    }
    if (account) {
      subject = {
        uid: account.id,
        user: account.username,
        role: account.role,
        usr: account.usr,
        pwdAt: Date.parse(account.passwordChangedAt) || 0,
      };
    }
  }

  if (!subject) return rejected;

  const redirectTo = safeNextPath(typeof next === 'string' ? next : null);
  const token = await createSessionToken(subject);

  const response = NextResponse.json({ ok: true, redirectTo, role: subject.role });
  response.cookies.set(
    SESSION_COOKIE,
    token,
    // Secure only over HTTPS: a `secure` cookie is silently dropped on plain
    // http://, which would make sign-in fail with no visible error on a LAN
    // deployment or over a tunnel. Read through isSecureRequest rather than
    // from request.url, because behind a proxy that terminates TLS this process
    // sees http even though the browser is on https — and dropping Secure there
    // is exactly the deployment where it matters most.
    sessionCookieOptions(isSecureRequest(request)),
  );
  return response;
}
